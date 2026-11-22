#!/usr/bin/env python3
"""
Pixel Agents Bridge Daemon for Antigravity Agents
Connects Antigravity agent transcript activity into the Pixel Agents VS Code extension via local REST Webhook.
"""

import os
import sys
import time
import json
import glob
import logging
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, Tuple, Set

# Configure logging
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"
logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
logger = logging.getLogger("PixelBridge")

# Paths
HOME_DIR = os.path.expanduser("~")
SERVER_JSON_PATH = os.path.join(HOME_DIR, ".pixel-agents", "server.json")
SERVERS_DIR = os.path.join(HOME_DIR, ".pixel-agents", "servers")
BRAIN_DIR = os.path.join(HOME_DIR, ".gemini", "antigravity", "brain")
CLAUDE_PROJECTS_DIR = os.path.join(HOME_DIR, ".claude", "projects", "C--SQLLens")
CWD = r"C:\SQLLens"

# Explicit Main Agent Mappings
KNOWN_AGENTS = {
    "cc256256-a205-4796-aa6d-a314fe30201c": {
        "session_id": "Amelia-SP999",
        "name": "Amelia (Senior Developer - SP999 Fixes)",
        "role": "Senior Developer",
    },
    "dd818702-ac2e-477e-a1cd-b4bbb85c5602": {
        "session_id": "Antigravity-Coordinator",
        "name": "Antigravity Coordinator",
        "role": "Coordinator",
    },
    "e17813c2-660f-4699-be81-72d2dce1a251": {
        "session_id": "Amelia-Task156",
        "name": "Amelia (Dev - Task156)",
        "role": "Developer",
    },
    "deepseek-task154": {
        "session_id": "DeepSeek-Task154",
        "name": "DeepSeek (Senior Developer - Task154)",
        "role": "Senior Developer",
    }
}


class PixelAgentsClient:
    """Handles communication with the Pixel Agents local webhook server."""

    def __init__(self):
        self.port: Optional[int] = None
        self.token: Optional[str] = None
        self.last_config_mtime: float = 0.0
        self.registered_sessions: Set[str] = set()
        self.refresh_config()

    def refresh_config(self) -> bool:
        """Reads server.json and updates port/token."""
        # First check legacy / default server.json
        if os.path.exists(SERVER_JSON_PATH):
            try:
                mtime = os.path.getmtime(SERVER_JSON_PATH)
                if mtime != self.last_config_mtime or not self.port:
                    with open(SERVER_JSON_PATH, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    self.port = data.get("port")
                    self.token = data.get("token")
                    self.last_config_mtime = mtime
                    logger.info(f"Loaded Pixel Agents server config: port={self.port}, token={self.token[:8]}...")
                    return True
            except Exception as e:
                logger.warning(f"Error reading {SERVER_JSON_PATH}: {e}")

        # Check servers directory if server.json failed
        if os.path.isdir(SERVERS_DIR):
            for file in os.listdir(SERVERS_DIR):
                if file.endswith(".json"):
                    fp = os.path.join(SERVERS_DIR, file)
                    try:
                        with open(fp, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        if data.get("port") and data.get("token"):
                            self.port = data.get("port")
                            self.token = data.get("token")
                            logger.info(f"Loaded Pixel Agents server from {file}: port={self.port}")
                            return True
                    except Exception:
                        pass
        return self.port is not None and self.token is not None

    def send_event(self, event: Dict[str, Any]) -> bool:
        """Sends a hook event to the Pixel Agents server."""
        if not self.port or not self.token:
            if not self.refresh_config():
                logger.error("Pixel Agents server config not found. Is extension running?")
                return False

        url = f"http://127.0.0.1:{self.port}/api/hooks/claude"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}",
        }
        payload = json.dumps(event).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    return True
                logger.warning(f"Hook sent with status {resp.status}")
                return False
        except urllib.error.URLError as e:
            logger.warning(f"URLError connecting to {url}: {e}. Retrying config refresh...")
            self.port = None  # Force refresh next time
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending hook: {e}")
            return False

    def ensure_session(self, session_id: str, label: str) -> bool:
        """Sends SessionStart if session has not been registered yet."""
        if session_id in self.registered_sessions:
            return True

        # Ensure dummy transcript file exists in Claude project dir
        # so Pixel Agents can track and display the agent cleanly
        os.makedirs(CLAUDE_PROJECTS_DIR, exist_ok=True)
        transcript_file = os.path.join(CLAUDE_PROJECTS_DIR, f"{session_id}.jsonl")
        if not os.path.exists(transcript_file):
            try:
                with open(transcript_file, "w", encoding="utf-8") as f:
                    f.write(f'{{"agent": "{label}"}}\n')
            except Exception as e:
                logger.warning(f"Could not create transcript placeholder: {e}")

        payload = {
            "hook_event_name": "SessionStart",
            "session_id": session_id,
            "source": "startup",
            "cwd": CWD,
            "transcript_path": transcript_file,
        }
        logger.info(f"Registering session '{session_id}' ({label}) -> Pixel Agents")
        ok = self.send_event(payload)
        if ok:
            self.registered_sessions.add(session_id)
        return ok

    def pre_tool_use(self, session_id: str, tool_name: str, tool_input: Dict[str, Any]) -> bool:
        """Sends PreToolUse hook."""
        payload = {
            "hook_event_name": "PreToolUse",
            "session_id": session_id,
            "tool_name": tool_name,
            "tool_input": tool_input,
        }
        return self.send_event(payload)

    def post_tool_use(self, session_id: str) -> bool:
        """Sends PostToolUse hook."""
        payload = {
            "hook_event_name": "PostToolUse",
            "session_id": session_id,
        }
        return self.send_event(payload)

    def stop(self, session_id: str) -> bool:
        """Sends Stop hook."""
        payload = {
            "hook_event_name": "Stop",
            "session_id": session_id,
        }
        return self.send_event(payload)


def clean_string(s: Any, max_len: int = 60) -> str:
    """Helper to clean and truncate string inputs."""
    if not isinstance(s, str):
        s = str(s) if s is not None else ""
    s = s.replace("\r", " ").replace("\n", " ")
    s = s.strip().strip('"').strip("'")
    if len(s) > max_len:
        return s[:max_len] + "…"
    return s


def map_tool_to_claude(tool_name: str, args: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """Maps Antigravity tool calls to Claude format for Pixel Agents visual status."""
    if not isinstance(args, dict):
        args = {}

    if tool_name == "run_command":
        cmd = args.get("toolSummary") or args.get("CommandLine") or "Running command"
        cmd = clean_string(cmd, 60)
        return "Bash", {"command": cmd}

    if tool_name == "read_file":
        path = args.get("Path", "")
        path = clean_string(path, 60)
        return "Read", {"file_path": path}

    if tool_name == "edit_file":
        path = args.get("Path", "")
        path = clean_string(path, 60)
        return "Edit", {"file_path": path}

    if tool_name == "write_file":
        path = args.get("Path", "")
        path = clean_string(path, 60)
        return "Write", {"file_path": path}

    if tool_name == "manage_task":
        action = clean_string(args.get("Action", ""), 20)
        tid = clean_string(args.get("TaskId", ""), 30)
        return "Bash", {"command": f"task {action} {tid}"}

    if tool_name == "search_web":
        q = clean_string(args.get("query", ""), 50)
        return "WebSearch", {"query": q}

    if tool_name == "send_message":
        recipient = clean_string(args.get("Recipient", ""), 30)
        return "SendMessage", {"recipient": recipient}

    if tool_name == "invoke_subagent":
        role = clean_string(args.get("Role", "subagent"), 40)
        return "Task", {"description": f"Subagent: {role}"}

    if tool_name == "call_mcp_tool":
        tname = clean_string(args.get("ToolName", "mcp"), 40)
        return "Bash", {"command": f"MCP: {tname}"}

    # Default fallback
    return "Bash", {"command": clean_string(tool_name, 50)}


class TranscriptWatcher:
    """Monitors and tails a single transcript.jsonl file."""

    def __init__(self, conversation_id: str, file_path: str, session_id: str, agent_label: str):
        self.conversation_id = conversation_id
        self.file_path = file_path
        self.session_id = session_id
        self.agent_label = agent_label
        self.file_offset: int = 0
        self.is_in_tool: bool = False
        self.last_activity: float = time.time()
        self.is_stopped: bool = False

        # Initialize offset: read up to the end minus a small tail
        if os.path.exists(self.file_path):
            file_size = os.path.getsize(self.file_path)
            # If large file, start from near the end (last ~4KB) to avoid back-flooding
            if file_size > 4096:
                self.file_offset = file_size - 4096
            else:
                self.file_offset = 0

    def poll(self, client: PixelAgentsClient):
        """Checks for new lines in transcript and emits hook events."""
        if not os.path.exists(self.file_path):
            return

        try:
            current_size = os.path.getsize(self.file_path)
            if current_size < self.file_offset:
                # File truncated or rotated
                self.file_offset = 0

            if current_size == self.file_offset:
                # Check for idle timeout (idle for > 15s)
                if not self.is_stopped and (time.time() - self.last_activity > 15.0):
                    if self.is_in_tool:
                        client.post_tool_use(self.session_id)
                        self.is_in_tool = False
                    client.stop(self.session_id)
                    self.is_stopped = True
                    logger.debug(f"Agent {self.session_id} is idle -> Stop")
                return

            with open(self.file_path, "r", encoding="utf-8", errors="ignore") as f:
                f.seek(self.file_offset)
                chunk = f.read()
                self.file_offset = f.tell()

            lines = chunk.splitlines()
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    self.process_entry(data, client)
                except json.JSONDecodeError:
                    continue

        except Exception as e:
            logger.warning(f"Error polling {self.file_path}: {e}")

    def process_entry(self, data: Dict[str, Any], client: PixelAgentsClient):
        """Processes a single transcript JSON entry."""
        self.last_activity = time.time()
        self.is_stopped = False

        client.ensure_session(self.session_id, self.agent_label)

        tool_calls = data.get("tool_calls")
        entry_type = data.get("type")
        source = data.get("source")

        if tool_calls and isinstance(tool_calls, list) and len(tool_calls) > 0:
            tc = tool_calls[0]
            name = tc.get("name", "unknown")
            args = tc.get("args", {})
            c_tool, c_input = map_tool_to_claude(name, args)

            logger.info(f"[{self.session_id}] PreToolUse -> {c_tool}: {c_input}")
            client.pre_tool_use(self.session_id, c_tool, c_input)
            self.is_in_tool = True
            return

        if self.is_in_tool and (entry_type == "GENERIC" or source == "SYSTEM"):
            logger.info(f"[{self.session_id}] PostToolUse (Tool Finished)")
            client.post_tool_use(self.session_id)
            self.is_in_tool = False
            return

        status = data.get("status")
        if status == "WAITING_FOR_USER" or (entry_type == "PLANNER_RESPONSE" and not tool_calls):
            if self.is_in_tool:
                client.post_tool_use(self.session_id)
                self.is_in_tool = False
            logger.info(f"[{self.session_id}] Stop (Waiting / Turn End)")
            client.stop(self.session_id)
            self.is_stopped = True


class PixelAgentsBridge:
    """Main daemon coordinating client and transcript watchers."""

    def __init__(self):
        self.client = PixelAgentsClient()
        self.watchers: Dict[str, TranscriptWatcher] = {}
        self.running: bool = True

    def init_known_agents(self):
        """Initializes known project agents."""
        logger.info("Initializing known agents...")
        for conv_id, info in KNOWN_AGENTS.items():
            session_id = info["session_id"]
            name = info["name"]
            self.client.ensure_session(session_id, name)

            if conv_id != "deepseek-task154":
                t_path = os.path.join(BRAIN_DIR, conv_id, ".system_generated", "logs", "transcript.jsonl")
                if os.path.exists(t_path):
                    self.watchers[conv_id] = TranscriptWatcher(conv_id, t_path, session_id, name)
                    logger.info(f"Attached watcher for {name} ({conv_id})")

    def scan_for_transcripts(self):
        """Scans for active conversations in the last 4 hours."""
        if not os.path.isdir(BRAIN_DIR):
            return

        now = time.time()
        for folder in os.listdir(BRAIN_DIR):
            conv_dir = os.path.join(BRAIN_DIR, folder)
            if not os.path.isdir(conv_dir):
                continue

            t_path = os.path.join(conv_dir, ".system_generated", "logs", "transcript.jsonl")
            if not os.path.exists(t_path):
                continue

            # Only track if modified recently (within 4 hours)
            try:
                mtime = os.path.getmtime(t_path)
                if now - mtime > 4 * 3600:
                    continue
            except Exception:
                continue

            if folder in self.watchers:
                continue

            # Check if it's one of our known agents
            if folder in KNOWN_AGENTS:
                info = KNOWN_AGENTS[folder]
                sid = info["session_id"]
                label = info["name"]
            else:
                sid = f"agent-{folder[:8]}"
                label = f"Subagent {folder[:8]}"

            watcher = TranscriptWatcher(folder, t_path, sid, label)
            self.watchers[folder] = watcher
            logger.info(f"Discovered new active conversation: {label} ({folder})")

    def run(self):
        """Main loop."""
        logger.info("Pixel Agents Bridge Daemon starting...")
        self.init_known_agents()

        last_scan = 0.0
        while self.running:
            try:
                now = time.time()
                # Scan directory for new transcripts every 4 seconds
                if now - last_scan > 4.0:
                    self.scan_for_transcripts()
                    last_scan = now

                # Poll all active watchers
                for watcher in list(self.watchers.values()):
                    watcher.poll(self.client)

                time.sleep(0.3)
            except KeyboardInterrupt:
                logger.info("Stopping daemon...")
                self.running = False
                break
            except Exception as e:
                logger.error(f"Error in main loop: {e}")
                time.sleep(1.0)


def run_self_test():
    """Runs a standalone connection test."""
    print("=" * 60)
    print("PIXEL AGENTS BRIDGE SELF-TEST")
    print("=" * 60)

    client = PixelAgentsClient()
    if not client.port or not client.token:
        print("FAIL: Could not locate server.json or valid port/token.")
        sys.exit(1)

    print(f"SUCCESS: Connected to server config: port={client.port}")

    test_sid = "Amelia-SP999"
    print(f"Sending SessionStart for {test_sid}...")
    ok1 = client.ensure_session(test_sid, "Amelia (Senior Developer - SP999 Fixes)")
    print(f"SessionStart result: {ok1}")

    print(f"Sending PreToolUse for {test_sid}...")
    ok2 = client.pre_tool_use(test_sid, "Bash", {"command": "git status"})
    print(f"PreToolUse result: {ok2}")

    time.sleep(0.5)
    print(f"Sending PostToolUse for {test_sid}...")
    ok3 = client.post_tool_use(test_sid)
    print(f"PostToolUse result: {ok3}")

    time.sleep(0.5)
    print(f"Sending Stop for {test_sid}...")
    ok4 = client.stop(test_sid)
    print(f"Stop result: {ok4}")

    if all([ok1, ok2, ok3, ok4]):
        print("=" * 60)
        print("ALL TESTS PASSED! HTTP 200 OK across all event types.")
        print("=" * 60)
    else:
        print("SOME TESTS FAILED! Check server output.")


if __name__ == "__main__":
    if "--test" in sys.argv:
        run_self_test()
    else:
        bridge = PixelAgentsBridge()
        bridge.run()
