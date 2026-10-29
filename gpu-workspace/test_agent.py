"""CPU-only runtime contract tests; no model, GPU, dataset or remote Pod is started."""
import asyncio
import importlib.util
import os
import stat
import tempfile
import json
import threading
import time
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
start_spec=importlib.util.spec_from_file_location("arena_start",Path(__file__).with_name("start.py"))
startup=importlib.util.module_from_spec(start_spec)
start_spec.loader.exec_module(startup)

class ServiceModeTests(unittest.TestCase):
    def test_llm_only_needs_no_jupyter_token_and_starts_no_notebook(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ,{},clear=True):
            commands=startup.launch_plan(Path(temp),"llm")
            self.assertEqual(len(commands),1)
            self.assertEqual(commands[0][0],"uvicorn")
            self.assertFalse((Path(temp)/"data").exists())

    def test_jupyter_only_starts_notebook_with_agent_and_no_model_command(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ,{"JUPYTER_TOKEN":"qa-jupyter-token"}):
            commands=startup.launch_plan(Path(temp),"jupyter")
            self.assertEqual([c[0] for c in commands],["jupyter","uvicorn"])
            self.assertFalse((Path(temp)/"data").exists())
            self.assertFalse((Path(temp)/"Final").exists())

    def test_jupyter_mode_never_enables_model_worker(self):
        with patch.object(agent,"HAS_LLM",False), patch.object(agent,"stop_model"), patch.object(agent,"MODEL_ENABLED",__import__("threading").Event()):
            agent.apply_policy({"active":True,"llmEnabled":True,"runId":"public"})
            self.assertFalse(agent.MODEL_ENABLED.is_set())

class ArchiveTests(unittest.TestCase):
    def test_task_archives_merge_public_and_private_at_workspace_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for split in ("public_test", "private_test"):
                archive = root / (split + ".zip")
                with zipfile.ZipFile(archive, "w") as bundle:
                    bundle.writestr("Tac_vu_1/dataset/" + split + "/samples.csv", "id\n1\n")
                agent.safe_extract(archive, root / "workspace", task_root=True)
            self.assertTrue((root / "workspace/Tac_vu_1/dataset/public_test/samples.csv").exists())
            self.assertTrue((root / "workspace/Tac_vu_1/dataset/private_test/samples.csv").exists())
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr(".arena/policy.json", "{}")
            with self.assertRaises(ValueError):
                agent.safe_extract(archive, root / "workspace", task_root=True)

    def test_no_dataset_policy_never_downloads_even_if_assets_are_present(self):
        stop = Mock()
        stop.is_set.side_effect = [False, True]
        with patch.object(agent, "STOP", stop), patch.object(agent, "HAS_JUPYTER", True), patch.object(agent, "manifest", return_value={"active": True, "loadDataset": False, "assets": [{"name": "unused.zip"}]}), patch.object(agent, "apply_policy"), patch.object(agent, "load_asset") as load:
            agent.dataset_loop()
        load.assert_not_called()
        self.assertFalse(agent.STATE["publicReady"])
        self.assertFalse(agent.STATE["privateReady"])
        self.assertEqual(agent.STATE["stage"], "Không nạp dataset")

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
        agent.INFERENCE_SLOTS.clear()
        agent.UNCONFIRMED_SLOTS.clear()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=agent.app), base_url="http://pod.test", headers={"Authorization": "Bearer qa-agent-token"})

    async def asyncTearDown(self):
        await self.client.aclose()
        agent.INFERENCE_SLOTS.clear()
        agent.UNCONFIRMED_SLOTS.clear()

    async def test_parallel_generations_overlap_without_exceeding_capacity(self):
        entered, release = asyncio.Event(), asyncio.Event()
        active = set()
        async def completion(_url, json):
            active.add(json["id_slot"])
            if len(active) == 2:
                entered.set()
            await release.wait()
            return Mock(raise_for_status=Mock(), json=lambda: {"content": "answer", "tokens_predicted": 2})
        engine = AsyncMock()
        engine.__aenter__.return_value.post.side_effect = completion
        body = {"messages": [{"role": "user", "content": "hello"}], "maxTokens": 8, "expectedInputTokens": 3}
        with patch.object(agent, "LLM_PARALLEL", 2), patch.object(agent, "manifest", return_value={"active": True, "llmEnabled": True}), patch.object(agent, "tokenize", new=AsyncMock(return_value=[1,2,3])), patch.object(agent.httpx, "AsyncClient", return_value=engine):
            pending = [asyncio.create_task(self.client.post("/generate", json={**body, "slot": slot})) for slot in range(2)]
            try:
                await asyncio.wait_for(entered.wait(), 2)
                self.assertEqual((await self.client.post("/generate", json=body)).status_code, 409)
                self.assertEqual((await self.client.post("/generate", json={**body, "slot": 0})).status_code, 409)
                self.assertEqual(active, {0, 1})
            finally:
                release.set()
                responses = await asyncio.gather(*pending)
            self.assertEqual([r.status_code for r in responses], [200, 200])
            self.assertFalse(agent.INFERENCE_SLOTS)

    async def test_engine_timeout_quarantines_slot_until_idle_is_confirmed(self):
        import httpx
        engine = AsyncMock()
        post = engine.__aenter__.return_value.post
        post.side_effect = httpx.ReadTimeout("unconfirmed")
        body = {"messages": [{"role": "user", "content": "hello"}], "maxTokens": 8, "expectedInputTokens": 3, "slot": 0}
        with patch.object(agent, "manifest", return_value={"active": True, "llmEnabled": True}), patch.object(agent, "tokenize", new=AsyncMock(return_value=[1,2,3])), patch.object(agent.httpx, "AsyncClient", return_value=engine), patch.object(agent, "engine_slot_idle", new=AsyncMock(return_value=False)) as idle:
            self.assertEqual((await self.client.post("/generate", json=body)).status_code, 503)
            self.assertEqual(agent.UNCONFIRMED_SLOTS, {0})
            self.assertEqual((await self.client.post("/generate", json=body)).status_code, 409)
            self.assertEqual(post.await_count, 1)
            idle.return_value = True
            post.side_effect = None
            post.return_value = Mock(raise_for_status=Mock(), json=lambda: {"content": "ok", "tokens_predicted": 1})
            self.assertEqual((await self.client.post("/generate", json=body)).status_code, 200)
            self.assertFalse(agent.UNCONFIRMED_SLOTS)

    async def test_authentication_and_request_validation(self):
        self.assertEqual((await self.client.get("/health", headers={"Authorization": "wrong"})).status_code, 401)
        self.assertEqual((await self.client.post("/generate", json={"messages": [], "maxTokens": 99999, "expectedInputTokens": 1})).status_code, 422)

    async def test_exact_token_count_contract(self):
        with patch.object(agent, "tokenize", new=AsyncMock(return_value=[1, 2, 3])):
            response = await self.client.post("/token-count", json={"messages": [{"role": "user", "content": "hello"}]})
        self.assertEqual(response.json(), {"count": 3})

    async def test_jupyter_only_refuses_llm_routes(self):
        with patch.object(agent,"HAS_LLM",False), patch.object(agent,"tokenize",new=AsyncMock()) as tokenizer:
            response=await self.client.post("/token-count",json={"messages":[{"role":"user","content":"hello"}]})
            self.assertEqual(response.status_code,404)
            response=await self.client.post("/generate",json={"messages":[{"role":"user","content":"hello"}],"maxTokens":8,"expectedInputTokens":3})
            self.assertEqual(response.status_code,404)
            tokenizer.assert_not_called()

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

class QueueTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        idle = patch.object(agent, "engine_slot_idle", new=AsyncMock(return_value=True))
        idle.start()
        self.addCleanup(idle.stop)

    async def test_model_command_preserves_context_for_each_parallel_slot(self):
        with patch.object(agent, "LLM_PARALLEL", 4), patch.object(agent, "CONTEXT_SIZE", 4096):
            cmd = agent.model_command("model.gguf")
        self.assertEqual(cmd[cmd.index("--ctx-size") + 1], "16384")
        self.assertEqual(cmd[cmd.index("--parallel") + 1], "4")
        self.assertIn("--cont-batching", cmd)
        self.assertEqual(cmd[cmd.index("--host") + 1], "127.0.0.1")

    async def test_engine_readiness_checks_each_slots_context(self):
        slots = [{"id": 0, "n_ctx": 4096}, {"id": 1, "n_ctx": 1024}]
        with patch.object(agent, "LLM_PARALLEL", 2), patch.object(agent, "CONTEXT_SIZE", 4096), patch.object(agent, "engine_slots", new=AsyncMock(return_value=slots)):
            self.assertFalse(await agent.engine_ready())
            slots[1]["n_ctx"] = 4096
            self.assertTrue(await agent.engine_ready())

    async def test_busy_engine_journal_keeps_lease_without_restarting_inference(self):
        with tempfile.TemporaryDirectory() as temp:
            stop = threading.Event()
            async def callback(action, job=None, **extra):
                self.assertEqual(action, "heartbeat")
                stop.set()
                return {"open": True, "runId": "run"}
            with patch.object(agent, "ROOT", Path(temp)), patch.object(agent, "STOP", stop), patch.object(agent, "engine_slot_idle", new=AsyncMock(return_value=False)), patch.object(agent, "worker_call", side_effect=callback), patch.object(agent, "generate", new=AsyncMock()) as generate, patch.object(agent.asyncio, "sleep", new=AsyncMock()):
                agent.journal_write({"job": {"requestId": "r", "attempt": "a", "runId": "run", "slot": 1}}, 1)
                await agent.queue_loop(1)
                self.assertTrue(agent.journal_path(1).exists())
                generate.assert_not_called()

    async def test_journals_and_replayed_results_are_independent_per_slot(self):
        with tempfile.TemporaryDirectory() as temp:
            stop = threading.Event()
            seen = []
            async def callback(action, job, **extra):
                seen.append((action, job["slot"], extra["content"]))
                stop.set()
                return {"terminal": True}
            with patch.object(agent, "ROOT", Path(temp)), patch.object(agent, "STOP", stop), patch.object(agent, "worker_call", side_effect=callback):
                for slot in range(2):
                    agent.journal_write({"job": {"requestId": str(slot), "attempt": "a", "runId": "run"}, "result": {"content": str(slot)}}, slot)
                await agent.queue_loop(1)
                self.assertTrue(agent.journal_path(0).exists())
                self.assertFalse(agent.journal_path(1).exists())
                stop.clear()
                await agent.queue_loop(0)
                self.assertEqual(seen, [("complete", 1, "1"), ("complete", 0, "0")])

    async def test_legacy_journal_is_migrated_and_replayed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root / ".arena").mkdir(); stop = threading.Event()
            legacy = root / ".arena/chat-job.json"
            legacy.write_text(json.dumps({"job": {"requestId": "r", "attempt": "a", "runId": "run"}, "result": {"content": "old result"}}))
            async def callback(action, job, **extra):
                self.assertEqual((action, job["slot"], extra["content"]), ("complete", 0, "old result"))
                stop.set(); return {"terminal": True}
            with patch.object(agent, "ROOT", root), patch.object(agent, "STOP", stop), patch.object(agent, "worker_call", side_effect=callback), patch.object(agent, "generate", new=AsyncMock()) as generate:
                await agent.queue_loop()
                generate.assert_not_called()
                self.assertFalse(legacy.exists())

    async def test_known_private_deadline_stops_model_even_without_control_connection(self):
        stop = Mock(); stop.is_set.side_effect = [False, True]
        enabled = threading.Event(); enabled.set()
        with patch.object(agent, "STOP", stop), patch.object(agent, "MODEL_ENABLED", enabled), patch.object(agent, "POLICY_EXPIRES_AT", time.time() + 45), patch.object(agent, "PUBLIC_ENDS_AT", (time.time() - 1) * 1000), patch.object(agent, "stop_model") as terminate:
            agent.policy_watchdog()
            terminate.assert_called_once()
            self.assertFalse(enabled.is_set())

    async def test_trim_keeps_latest_prompt_and_respects_remaining_total(self):
        job = {"messages": [{"role": "user", "content": "old"}, {"role": "assistant", "content": "old answer"}, {"role": "user", "content": "latest"}],
               "template": {"sessionTokenLimit": 2000, "inputTokenLimit": 1800, "tokenLimitMode": "turn"},
               "inputTokens": 1900, "outputTokens": 50, "contextWindowTokens": 2128}
        with patch.object(agent, "tokenize", new=AsyncMock(side_effect=[list(range(100)), list(range(20))])):
            messages, count = await agent.trim_job(job)
        self.assertEqual([m.content for m in messages], ["latest"])
        self.assertEqual(count, 20)

    async def test_saved_result_is_reposted_without_inference(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root / ".arena").mkdir()
            stop = threading.Event()
            async def callback(action, job, **extra):
                self.assertEqual(action, "complete")
                self.assertEqual(extra["content"], "saved")
                stop.set(); return {"terminal": True}
            with patch.object(agent, "ROOT", root), patch.object(agent, "STOP", stop), patch.object(agent, "worker_call", side_effect=callback), patch.object(agent, "generate", new=AsyncMock()) as generate:
                agent.journal_write({"job": {"requestId": "r", "attempt": "a", "runId": "run"}, "result": {"content": "saved", "inputTokens": 20, "outputTokens": 5}})
                await agent.queue_loop()
                generate.assert_not_called()
                self.assertFalse((root / ".arena/chat-job.json").exists())

    async def test_restart_without_result_reports_failure_without_rerun(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root / ".arena").mkdir(); stop = threading.Event()
            async def callback(action, job, **extra):
                self.assertEqual(action, "fail")
                stop.set(); return {"terminal": True}
            with patch.object(agent, "ROOT", root), patch.object(agent, "STOP", stop), patch.object(agent, "worker_call", side_effect=callback), patch.object(agent, "generate", new=AsyncMock()) as generate:
                agent.journal_write({"job": {"requestId": "r", "attempt": "a", "runId": "run"}})
                await agent.queue_loop(); generate.assert_not_called()

    async def test_claim_prepare_generate_and_journal_complete_once(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root / ".arena").mkdir(); stop = threading.Event()
            actions = []
            job = {"requestId": "r", "attempt": "a", "runId": "run"}
            async def callback(action, job_arg=None, **extra):
                actions.append(action)
                if action == "claim": return {"job": job}
                if action == "prepare": return {"execute": True, "maxTokens": 64}
                stop.set(); return {"terminal": True}
            with patch.object(agent, "ROOT", root), patch.object(agent, "STOP", stop), patch.object(agent, "MODEL_ENABLED", threading.Event()), patch.object(agent, "worker_call", side_effect=callback), patch.object(agent, "trim_job", new=AsyncMock(return_value=([agent.Message(role="user", content="hello")], 20))), patch.object(agent, "generate", new=AsyncMock(return_value={"content": "answer", "inputTokens": 20, "outputTokens": 5})) as generate:
                await agent.queue_loop()
                self.assertEqual(actions, ["claim", "prepare", "complete"])
                generate.assert_awaited_once()

    async def test_control_outage_does_not_stop_a_fresh_policy(self):
        stop = Mock(); stop.is_set.side_effect = [False, True]
        with patch.object(agent, "STOP", stop), patch.object(agent, "POLICY_EXPIRES_AT", time.time() + 45), patch.object(agent, "manifest", side_effect=RuntimeError("temporary")), patch.object(agent, "stop_model") as terminate:
            agent.dataset_loop(); terminate.assert_not_called()

if __name__ == "__main__":
    unittest.main()
