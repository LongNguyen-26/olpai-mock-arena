import test from "node:test";
import assert from "node:assert/strict";
import { conversationRef, parseConversationRef, conversationTitle, draftCharacterCount, contestantSession } from "../src/lib/chat-conversation";

test("conversation references round-trip and reject malformed or non-conversation records",()=>{
  const pair:[string,string]=["chat-group-session","group:run:team-123:session"];
  assert.deepEqual(parseConversationRef(conversationRef(...pair)),pair);
  assert.equal(parseConversationRef(conversationRef("chat-job","request")),null);
  assert.equal(parseConversationRef("../unsafe"),null);
  assert.equal(parseConversationRef(Buffer.from('{"kind":"chat-session"}').toString("base64url")),null);
});
test("conversation titles remain bounded plain text; character count counts Unicode characters, not tokens or bytes",()=>{
  assert.equal(conversationTitle("  Hỏi\n  đáp\t AI  "),"Hỏi đáp AI");
  assert.equal(Array.from(conversationTitle("😀".repeat(80))).length,64);
  assert.equal(draftCharacterCount("Xin chào 😀"),10);
  assert.equal(draftCharacterCount(""),0);
});
test("contestant projection hides infrastructure failures without changing the stored transcript",()=>{
  const original={messages:[{role:"user" as const,content:"Câu hỏi về Groq"}],inputTokens:2,outputTokens:0,error:"Groq API key không hợp lệ"};
  const safe=contestantSession(original);
  assert.ok(!safe.error?.includes("Groq"));assert.equal(original.error,"Groq API key không hợp lệ");
  assert.equal(safe.messages[0].content,original.messages[0].content);
});
