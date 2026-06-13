import inspect
import claude_agent_sdk as s

print("VER", getattr(s, "__version__", "?"))
print("HAS create_sdk_mcp_server", hasattr(s, "create_sdk_mcp_server"))
print("HAS tool", hasattr(s, "tool"))
try:
    print("SIG tool", inspect.signature(s.tool))
except Exception as e:
    print("tool sig err", e)
try:
    print("SIG create", inspect.signature(s.create_sdk_mcp_server))
except Exception as e:
    print("create sig err", e)

# how are control requests (hooks / sdk mcp tool calls) dispatched? concurrency check
import os
d = os.path.dirname(s.__file__)
print("DIR", d)
