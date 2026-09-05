"""The protocol, checked without opening a socket.

Run with: python3 -m unittest discover -s sdk/python/tests
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rigorrun import AGENT_PROTOCOL_V2, AgentError, handle_request  # noqa: E402


def ok(task, environment):
    return {"status": "completed", "output": f"worked on {task.get('inputs', {})}"}


ok.rigorrun_name = "test-agent"
ok.rigorrun_version = "1.0.0"


class ProbeTests(unittest.TestCase):
    def test_answers_a_probe_before_doing_any_work(self):
        answer = handle_request(ok, {"probe": True})
        # RigorRun will not call an agent connected until this comes back.
        self.assertEqual(answer["ok"], True)
        self.assertEqual(answer["agent"]["name"], "test-agent")

    def test_names_itself_from_the_function_when_not_told(self):
        answer = handle_request(lambda t, e: {"output": ""}, {"probe": True})
        self.assertIn("name", answer["agent"])


class RequestTests(unittest.TestCase):
    def test_runs_the_agent_and_returns_its_account(self):
        answer = handle_request(
            ok,
            {
                "protocol": AGENT_PROTOCOL_V2,
                "task": {"instruction": "confirm it", "inputs": {"bookingId": "BKG-4001"}},
                "environment": {"mcpUrl": "http://127.0.0.1:1/mcp/x"},
            },
        )
        self.assertEqual(answer["status"], "completed")
        self.assertIn("BKG-4001", answer["output"])

    def test_refuses_a_protocol_it_does_not_speak(self):
        with self.assertRaises(AgentError):
            handle_request(ok, {"protocol": "something/else"})

    def test_an_agent_that_raises_is_a_failed_case_not_a_broken_transport(self):
        def explodes(task, environment):
            raise RuntimeError("the model timed out")

        answer = handle_request(
            explodes, {"protocol": AGENT_PROTOCOL_V2, "task": {}, "environment": {}}
        )
        # A crash is a result: that case failed, and whatever the agent managed
        # first is already in RigorRun's evidence. A transport error loses both.
        self.assertEqual(answer["status"], "failed")
        self.assertIn("the model timed out", answer["output"])

    def test_passes_cost_through_only_when_there_is_one(self):
        without = handle_request(
            lambda t, e: {"output": ""},
            {"protocol": AGENT_PROTOCOL_V2, "task": {}, "environment": {}},
        )
        # Absent, not zero. RigorRun reports an unknown cost as unknown.
        self.assertNotIn("costUsd", without)

        with_cost = handle_request(
            lambda t, e: {"output": "", "costUsd": 0.0},
            {"protocol": AGENT_PROTOCOL_V2, "task": {}, "environment": {}},
        )
        self.assertEqual(with_cost["costUsd"], 0.0)

    def test_truncates_an_account_rather_than_a_transcript(self):
        answer = handle_request(
            lambda t, e: {"output": "x" * 100_000},
            {"protocol": AGENT_PROTOCOL_V2, "task": {}, "environment": {}},
        )
        self.assertLessEqual(len(answer["output"]), 8000)

    def test_refuses_something_that_is_not_an_object(self):
        with self.assertRaises(AgentError):
            handle_request(ok, json.loads("[1,2,3]"))


if __name__ == "__main__":
    unittest.main()
