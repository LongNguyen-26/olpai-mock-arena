"""CPU-only runtime contract tests; no model, GPU, dataset or remote Pod is started."""
import asyncio
import importlib.util
import os
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

os.environ["ARENA_AGENT_TOKEN"] = "qa-agent-token"
test_temp = Path(__file__).resolve().parents[1] / ".local" / "gpu-tests"
test_temp.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(test_temp)
spec = importlib.util.spec_from_file_location("arena_agent", Path(__file__).with_name("agent.py"))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

class ArchiveTests(unittest.TestCase):
    def test_public_reopens_model_after_private_and_new_run(self):
        with patch.object(agent,"stop_model") as stop, patch.object(agent,"MODEL_RUN_ID",None), patch.object(agent,"MODEL_ENABLED", __import__("threading").Event()):
            agent.apply_policy({"active":True,"llmEnabled":True,"runId":"run1"})
            self.assertTrue(agent.MODEL_ENABLED.is_set())
            agent.apply_policy({"active":True,"llmEnabled":False,"runId":"run1"})
            self.assertFalse(agent.MODEL_ENABLED.is_set())
            agent.apply_policy({"active":True,"llmEnabled":True,"runId":"run2"})
            self.assertTrue(agent.MODEL_ENABLED.is_set())
            self.assertFalse(agent.STATE["chatLocked"])
            self.assertGreaterEqual(stop.call_count,3)
    def test_private_transition_releases_model_process(self):
        process = Mock()
        process.poll.return_value = None
        with patch.object(agent, "MODEL_PROCESS", process):
            agent.stop_model()
        process.terminate.assert_called_once()
        process.wait.assert_called_once_with(timeout=5)

    def test_safe_archive_extracts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "data.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("nested/train.csv", "id,label\n1,2\n")
            destination = root / "out"
            destination.mkdir()
            agent.safe_extract(archive, destination)
            self.assertTrue((destination / "nested/train.csv").exists())

    def test_rejects_zip_traversal_and_symlinks(self):
        for name in ("../private.csv", "C:/secret", "..\\secret", "/absolute"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                archive = root / "data.zip"
                with zipfile.ZipFile(archive, "w") as bundle:
                    bundle.writestr(name, "bad")
                with self.assertRaises(ValueError):
                    agent.safe_extract(archive, root / "out")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "data.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                link = zipfile.ZipInfo("link")
                link.create_system = 3
                link.external_attr = (stat.S_IFLNK | 0o777) << 16
                bundle.writestr(link, "../../secret")
            with self.assertRaises(ValueError):
                agent.safe_extract(archive, root / "out")

class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import httpx
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=agent.app), base_url="http://pod.test", headers={"Authorization": "Bearer qa-agent-token"})

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_authentication_and_request_validation(self):
        self.assertEqual((await self.client.get("/health", headers={"Authorization": "wrong"})).status_code, 401)
        self.assertEqual((await self.client.post("/generate", json={"messages": [], "maxTokens": 99999, "expectedInputTokens": 1})).status_code, 422)

    async def test_exact_token_count_contract(self):
        with patch.object(agent, "tokenize", new=AsyncMock(return_value=[1, 2, 3])):
            response = await self.client.post("/token-count", json={"messages": [{"role": "user", "content": "hello"}]})
        self.assertEqual(response.json(), {"count": 3})

    async def test_private_policy_blocks_inference_before_tokenization(self):
        with patch.object(agent, "manifest", return_value={"active": True, "llmEnabled": False}), patch.object(agent, "tokenize", new=AsyncMock()) as tokenizer:
            response = await self.client.post("/generate", json={"messages": [{"role": "user", "content": "hello"}], "maxTokens": 50, "expectedInputTokens": 3})
        self.assertEqual(response.status_code, 403)
        tokenizer.assert_not_called()

    async def test_token_count_mismatch_blocks_inference(self):
        with patch.object(agent, "manifest", return_value={"active": True, "llmEnabled": True}), patch.object(agent, "tokenize", new=AsyncMock(return_value=[1, 2])):
            response = await self.client.post("/generate", json={"messages": [{"role": "user", "content": "hello"}], "maxTokens": 50, "expectedInputTokens": 3})
        self.assertEqual(response.status_code, 422)

    async def test_old_run_request_is_rejected_after_reset(self):
        with patch.object(agent,"manifest",return_value={"active":True,"llmEnabled":True,"runId":"new"}), patch.object(agent,"tokenize",new=AsyncMock()) as tokenizer:
            response=await self.client.post("/generate",json={"messages":[{"role":"user","content":"hello"}],"maxTokens":50,"expectedInputTokens":3,"runId":"old"})
        self.assertEqual(response.status_code,403)
        tokenizer.assert_not_called()

if __name__ == "__main__":
    unittest.main()
