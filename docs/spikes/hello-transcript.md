CREATE session status: 201
CREATE session body: {
  "data": {
    "id": "01m772r4zzy258v7qjxy03ya2b",
    "agent": {
      "type": "inline",
      "spec": {
        "model": {
          "name": "fake-provider/test-model"
        },
        "instructions": "You are a helpful assistant.",
        "config": {
          "iteration_limit": 512,
          "sandbox": {
            "enabled": false,
            "file_downloads": true
          },
          "dynamic_sub_agents": {
            "enabled": true
          },
          "context_management": {
            "compaction": {
              "enabled": true
            },
            "large_tool_response": {
              "enabled": true
            }
          },
          "generative_ui": {
            "enabled": true
          },
          "ask_user_questions": {
            "enabled": true
          },
          "web_search": {
            "enabled": false
          }
        }
      }
    },
    "title": null,
    "shared": false,
    "created_by_subject": {
      "subject_id": "trueforge-default",
      "subject_type": "user",
      "subject_display_name": "trueforge-default"
    },
    "created_at": "2026-11-12T05:12:37.634Z",
    "updated_at": "2026-11-12T05:12:37.634Z",
    "metrics": {
      "total_duration_ms": 0,
      "total_turns": 0
    },
    "metadata": {},
    "source": null,
    "last_turn_details": null
  }
}
TURN status: 200
TURN content-type: text/event-stream
data: {"type":"turn.created","id":"01m772r50w9f98h6tz3akvnq5s","turn_id":"01m772r50fw4djd7gxbjvr15yp","previous_turn_id":null,"input":[{"type":"user.message","content":"Say hello and one sentence about yourself."}],"state":{"status":"running"},"created_at":"2026-11-12T05:12:37.655Z","thread_id":null}
id: 1

data: {"type":"model.message","thread_id":"main","created_at":"2026-11-12T05:12:37.666Z","id":"01m772r511yb4czv1svb97pnr6","model":{"name":"fake-provider/test-model","params":{"max_tokens":4096}}}
id: 2

data: {"content":"Hello from the fake model. ","type":"model.message.delta","id":"01m772r511yb4czv1svb97pnr6","thread_id":"main","created_at":"2026-11-12T05:12:37.699Z"}
id: 3

data: {"content":"The agent loop works.","type":"model.message.delta","id":"01m772r511yb4czv1svb97pnr6","thread_id":"main"}
id: 4

data: {"type":"model.message.delta","id":"01m772r511yb4czv1svb97pnr6","thread_id":"main","finish_reason":"stop","usage":{"input_tokens":0,"output_tokens":0,"input_tokens_breakdown":{"harness":1302,"skills":0,"instructions":7,"tool_definitions":0,"messages":0}}}
id: 5

data: {"type":"turn.done","id":"01m772r52e831acfaqc23szhnc","created_at":"2026-11-12T05:12:37.710Z","state":{"status":"done","output":{"content":"Hello from the fake model. The agent loop works.","type":"model.message","id":"01m772r511yb4czv1svb97pnr6","created_at":"2026-11-12T05:12:37.707Z","thread_id":"main","finish_reason":"stop","usage":{"input_tokens":0,"output_tokens":0,"input_tokens_breakdown":{"harness":1302,"skills":0,"instructions":7,"tool_definitions":0,"messages":0}},"model":{"name":"fake-provider/test-model","params":{"max_tokens":4096}}},"required_actions":[],"completed_at":"2026-11-12T05:12:37.710Z","metrics":{"total_input_tokens":0,"total_output_tokens":0,"total_tokens":0}},"thread_id":null}
id: 6


[sse chunks: 4]
TURNS after: {
  "data": [
    {
      "id": "01m772r50fw4djd7gxbjvr15yp",
      "session_id": "01m772r4zzy258v7qjxy03ya2b",
      "previous_turn_id": null,
      "input": [
        {
          "type": "user.message",
          "content": "Say hello and one sentence about yourself."
        }
      ],
      "state": {
        "status": "done",
        "output": {
          "content": "Hello from the fake model. The agent loop works.",
          "type": "model.message",
          "id": "01m772r511yb4czv1svb97pnr6",
          "created_at": "2026-11-12T05:12:37.707Z",
          "thread_id": "main",
          "finish_reason": "stop",
          "usage": {
            "input_tokens": 0,
            "output_tokens": 0,
            "input_tokens_breakdown": {
              "harness": 1302,
              "skills": 0,
              "instructions": 7,
              "tool_definitions": 0,
              "messages": 0
            }
          },
          "model": {
            "name": "fake-provider/test-model",
            "params": {
              "max_tokens": 4096
            }
          }
        },
        "required_actions": [],
        "completed_at": "2026-11-12T05:12:37.710Z",
        "metrics": {
          "total_input_tokens": 0,
          "total_output_tokens": 0,
          "total_tokens": 0
        }
      },
      "created_at": "2026-11-12T05:12:37.656Z"
    }
  ],
  "pagination": {
    "limit": 25
  }
}
