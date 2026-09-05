# Putting a Python agent under test

If your agent is Python, this is the whole integration.

```python
from rigorrun import run_stdio

def my_agent(task, environment):
    # Point your existing MCP client at environment["mcpUrl"] and work.
    return {"status": "completed", "output": "Confirmed the booking."}

run_stdio(my_agent)
```

Then in RigorRun, connect an agent that is **a command on this machine**:
`python3`, with your file as its argument.

Listening on a port instead:

```python
from rigorrun import serve

serve(my_agent).serve_forever()
```

## What you get

The tedious parts that are easy to get subtly wrong: the probe RigorRun sends
to check you are there before it starts a run, request validation, error
shaping, and a body limit.

`environment["mcpUrl"]` is an ordinary streamable-HTTP MCP endpoint scoped to
one case. Connect to it however your agent already connects to MCP.

`output` is your account of what you did. It is shown beside the verdict and
**never scored** — the verdict comes from reading your system afterwards, so
there is nothing to gain by being generous and nothing to lose by being honest.

## What you do not get

No loop, no memory, no tool abstraction. RigorRun evaluates agents, and the
moment this starts offering those it is competing with the thing it is supposed
to measure — and every opinion it takes narrows what it can honestly measure.

## Standard library only

No dependencies, on purpose. An agent under test should not have to reconcile
its dependencies with its test harness's, and a package that made you do that
would be a reason not to bother.

Python 3.9 or newer.

## An exception is a result, not a crash

If your function raises, RigorRun records that case as failed with the
exception on it. Whatever your agent managed to do first is already in the
evidence, because it went through the proxy. Turning a raise into a transport
error would lose both.

## One process per case

`run_stdio` answers one case and exits. RigorRun starts your command again for
the next one, because a case is the isolation unit everywhere else in the
product — a long-lived process lets case seven inherit case six's memory, which
is exactly what `isolation: RESET` claims did not happen.

## A working one

`fixtures/external/python-agent/agent.py`. It hand-rolls its MCP client in about
forty lines of `urllib`, deliberately: the point is that an agent already
speaking MCP needs nothing from RigorRun, and proving that with somebody's SDK
would prove something about the SDK.

## Installing it

Not on PyPI. Copy `sdk/python/rigorrun/__init__.py` — it is one file with no
dependencies — or `pip install ./sdk/python` from a clone.
