# rigorrun (Python)

Put an existing Python agent under test with RigorRun.

**Not on PyPI.** The name `rigorrun` on PyPI is not ours. Install it from a
clone, or copy the one file — it is standard library only and has no
dependencies on purpose, because an agent under test should not have to
reconcile its dependencies with its test harness's.

```bash
pip install ./sdk/python
# or: cp sdk/python/rigorrun/__init__.py your_project/rigorrun.py
```

```python
from rigorrun import serve

def agent(task):
    # task.instruction, task.mcp_url — do the work however you normally would.
    return "issued the refund against ticket TCK-4001"

serve(agent, port=7331)
```

RigorRun sends one task per case and reads your system afterwards to decide
whether the work was actually done. An exception inside your agent becomes a
failed case rather than a transport error.

The wire protocol is plain HTTP and is documented in
[docs/HTTP_AGENT.md](../../docs/HTTP_AGENT.md); there is nothing here you cannot
implement directly in ten lines if you would rather not vendor a file.

MIT licensed.
