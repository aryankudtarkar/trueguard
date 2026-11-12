bad-provider register: bad-provider
session: 01m7730myn0gh7d0720e8z319w
turn status: 200 text/event-stream
SSE stream: data: {"type":"turn.created","id":"01m7730myv35azazsqdr5gs64c","turn_id":"01m7730mys6cfrxmc9y36f8hm0","previous_turn_id":null,"input":[{"type":"user.message","content":"hi"}],"state":{"status":"running"},"created_at":"2026-11-12T05:17:16.122Z","thread_id":null}
id: 1

data: {"type":"model.message","thread_id":"main","created_at":"2026-11-12T05:17:16.124Z","id":"01m7730myw1k7d51ps1yr4dxa1","model":{"name":"bad-provider/bad-model","params":{"max_tokens":10}}}
id: 2

data: {"type":"turn.done","id":"01m7730mz413rvpp3jmqe8wpyz","created_at":"2026-11-12T05:17:16.132Z","state":{"status":"error","message":"[Model Error] Cannot connect to API: bad port","completed_at":"2026-11-12T05:17:16.132Z","metrics":{"total_input_tokens":0,"total_output_tokens":0,"total_tokens":0}},"thread_id":null}
id: 3


patch status: 200
patched model: fake-provider/test-model
turn2 status: 200 text/event-stream
turn2 stream tail: ain","finish_reason":"stop","usage":{"input_tokens":0,"output_tokens":0,"input_tokens_breakdown":{"harness":1288,"skills":0,"instructions":0,"tool_definitions":0,"messages":0}}}
id: 5

data: {"type":"turn.done","id":"01m7730mzmwd6v64616pv0zpqg","created_at":"2026-11-12T05:17:16.148Z","state":{"status":"done","output":{"content":"Hello from the fake model. The agent loop works.","type":"model.message","id":"01m7730mzfp1yrmj4yevyzy4my","created_at":"2026-11-12T05:17:16.147Z","thread_id":"main","finish_reason":"stop","usage":{"input_tokens":0,"output_tokens":0,"input_tokens_breakdown":{"harness":1288,"skills":0,"instructions":0,"tool_definitions":0,"messages":0}},"model":{"name":"fake-provider/test-model","params":{"max_tokens":4096}}},"required_actions":[],"completed_at":"2026-11-12T05:17:16
