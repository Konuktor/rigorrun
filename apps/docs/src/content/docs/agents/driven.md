---
title: An agent you drive
description: When RigorRun cannot start or reach your agent, it makes a key and your own loop pulls work instead.
---

Some agents cannot be called: they live behind a login, in a notebook, in another network, or in a
product you do not control. RigorRun never calls these. Your loop asks for work instead.

## Make a key

In the interface, choose **RigorRun cannot start it — I will drive it** and press **Make a key**.

:::caution
Copy it then. It is not stored anywhere you can read it back, and it is not in the project file.
:::

## The loop

```python
import requests

BASE = "http://127.0.0.1:41925"
KEY  = "..."            # from the interface
AGENT = "agent_..."     # from the interface
headers = {"authorization": f"Bearer {KEY}"}

while True:
    work = requests.get(f"{BASE}/api/drive/{AGENT}", headers=headers).json()
    if not work.get("task"):
        break                                   # the suite is finished

    report = your_agent(work["task"], work["tools"], work["url"])

    requests.post(
        f"{BASE}/api/drive/{AGENT}/finished",
        headers=headers,
        json={"report": report},
    )
```

About twenty lines. Your agent can be anything that can make an HTTP request.

## Why this exists

The alternative is an agent that has to be reachable from this machine, which for a lot of real
agents means changing where they run in order to test them. Testing something should not require
moving it.
