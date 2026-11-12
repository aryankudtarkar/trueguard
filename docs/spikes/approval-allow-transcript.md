session: 01m772ztwr0wvbcfwas23dh5x6 201
turn1 status: 200
[turn1] event: {"type":"turn.created","id":"01m772ztx56r3v5jh3khq5evxw","turn_id":"01m772ztx3b4zht572n9pnbfw0","previous_turn_id":null,"input":[{"type":"user.message","content":"Call the echo tool with text \"hello-approval\" and tell me the result."}],"state":{"status":"running"},"created_at":"2026-11-12T05:16:49.444Z","thread_id":null}
[turn1] event: {"type":"mcp.initialize","id":"01m772ztxe6mvqsqvg7p732j2h","created_at":"2026-11-12T05:16:49.454Z","thread_id":"main","mcp_servers":[{"name":"spike-echo","id":"spike-echo","transport_type":"streamable-http"}]}
[turn1] event: {"type":"model.message","thread_id":"main","created_at":"2026-11-12T05:16:49.455Z","id":"01m772ztxfswtt537p3wb551fv","model":{"name":"fake-provider/test-model","params":{"max_tokens":4096}}}
[turn1] event: {"content":"I will call echo now.","type":"model.message.delta","id":"01m772ztxfswtt537p3wb551fv","thread_id":"main","created_at":"2026-11-12T05:16:49.459Z"}
[turn1] event: {"tool_calls":[{"index":0,"id":"call_fake_1","type":"function","function":{"name":"echo","arguments":""},"tool_info":{"type":"mcp","name":"echo","server_id":"spike-echo","server_name":"spike-echo"}}],"type":"model.message.delta","id":"01m772ztxfswtt537p3wb551fv","thread_id":"main"}
[turn1] event: {"tool_calls":[{"index":0,"function":{"arguments":"{\"text\":\"hello-approval\"}"}}],"type":"model.message.delta","id":"01m772ztxfswtt537p3wb551fv","thread_id":"main"}
[turn1] event: {"type":"model.message.delta","id":"01m772ztxfswtt537p3wb551fv","thread_id":"main","finish_reason":"tool_calls","usage":{"input_tokens":0,"output_tokens":0,"input_tokens_breakdown":{"harness":1857,"skills":0,"instructions":5,"tool_definitions":62,"messages":0}}}
[turn1] event: {"type":"tool.approval_required","id":"01m772ztxnn8ykmx8vxff8zgqj","created_at":"2026-11-12T05:16:49.461Z","thread_id":"main","tool_calls":[{"id":"call_fake_1","source_event_id":"01m772ztxfswtt537p3wb551fv"}]}
[turn1] event: {"type":"turn.done","id":"01m772ztxnn8ykmx8vxff8zgqk","created_at":"2026-11-12T05:16:49.461Z","state":{"status":"done","output":null,"required_actions":[{"type":"tool.approval_required","id":"01m772ztxnn8ykmx8vxff8zgqj","created_at":"2026-11-12T05:16:49.461Z","thread_id":"main","tool_calls":[{"id":"call_fake_1","source_event_id":"01m772ztxfswtt537p3wb551fv"}]}],"completed_at":"2026-11-12T05:16:49.461Z","metrics":{"total_input_tokens":0,"total_output_tokens":0,"total_tokens":0}},"thread_id":null}

=== approval event: {
  "type": "tool.approval_required",
  "id": "01m772ztxnn8ykmx8vxff8zgqj",
  "created_at": "2026-11-12T05:16:49.461Z",
  "thread_id": "main",
  "tool_calls": [
    {
      "id": "call_fake_1",
      "source_event_id": "01m772ztxfswtt537p3wb551fv"
    }
  ]
}

=== tool call ref: {"id":"call_fake_1","source_event_id":"01m772ztxfswtt537p3wb551fv"}

decision turn status: 200
[turn2] event: {"type":"turn.created","id":"01m772ztxw431jva9at1cegdqq","turn_id":"01m772ztxr11gxf4cnqx82n5tf","previous_turn_id":"01m772ztx3b4zht572n9pnbfw0","input":[{"type":"user.tool_approval","thread_id":"main","tool_call_id":"call_fake_1","approval":{"status":"allow"}}],"state":{"status":"running"},"created_at":"2026-11-12T05:16:49.466Z","thread_id":null}
[turn2] event: {"type":"mcp.initialize","id":"01m772zty5g9jnf8d07fdq68ma","created_at":"2026-11-12T05:16:49.477Z","thread_id":"main","mcp_servers":[{"name":"spike-echo","id":"spike-echo","transport_type":"streamable-http"}]}
[turn2] event: {"tool_call_id":"call_fake_1","content":"echo:hello-approval","type":"tool.response","id":"01m772zty8mn944v45gc1v07e5","created_at":"2026-11-12T05:16:49.479Z","thread_id":"main"}
[turn2] event: {"type":"model.message","thread_id":"main","created_at":"2026-11-12T05:16:49.480Z","id":"01m772zty8mn944v45gc1v07e6","model":{"name":"fake-provider/test-model","params":{"max_tokens":4096}}}
[turn2] event: {"content":"The tool returned: echo:hello-approval","type":"model.message.delta","id":"01m772zty8mn944v45gc1v07e6","thread_id":"main","created_at":"2026-11-12T05:16:49.484Z"}
[turn2] event: {"type":"model.message.delta","id":"01m772zty8mn944v45gc1v07e6","thread_id":"main","finish_reason":"stop","usage":{"input_tokens":0,"output_tokens":0,"input_tokens_breakdown":{"harness":1857,"skills":0,"instructions":5,"tool_definitions":62,"messages":0}}}
[turn2] event: {"type":"turn.done","id":"01m772ztydj74zbta929z96vsk","created_at":"2026-11-12T05:16:49.485Z","state":{"status":"done","output":{"content":"The tool returned: echo:hello-approval","type":"model.message","id":"01m772zty8mn944v45gc1v07e6","created_at":"2026-11-12T05:16:49.484Z","thread_id":"main","finish_reason":"stop","usage":{"input_tokens":0,"output_tokens":0,"input_tokens_breakdown":{"harness":1857,"skills":0,"instructions":5,"tool_definitions":62,"messages":0}},"model":{"name":"fake-provider/

=== turn2 event types: turn.created, mcp.initialize, tool.response, model.message, model.message.delta, model.message.delta, turn.done
