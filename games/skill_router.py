"""Build an agent execution packet from games/skill-routing.json."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(__file__).with_name("skill-routing.json")


class RoutingError(Exception):
    """Raised when the routing config is incomplete or unsafe."""


def require_object(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise RoutingError(f"{name} must be a JSON object with string keys")
    return value


def require_string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RoutingError(f"{name} must be a non-empty string")
    return value


def require_string_list(value: object, name: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise RoutingError(f"{name} must be a list of strings")
    return value


def read_config() -> dict[str, object]:
    try:
        raw: object = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RoutingError(f"Cannot read routing config: {error}") from error
    return require_object(raw, "root config")


def resolve_skill_path(raw_path: object) -> str:
    relative = require_string(raw_path, "skill path")
    resolved = (ROOT / relative).resolve()
    try:
        resolved.relative_to(ROOT)
    except ValueError as error:
        raise RoutingError(f"Skill path escapes the repository: {relative}") from error
    if not resolved.is_file():
        raise RoutingError(f"Skill file does not exist: {relative}")
    return relative.replace("\\", "/")


def select_skill(
    key: str,
    game_skills: dict[str, object],
    global_skills: dict[str, object],
) -> str:
    if key in global_skills:
        return resolve_skill_path(global_skills[key])
    if key in game_skills:
        return resolve_skill_path(game_skills[key])
    raise RoutingError(f"Unknown skill key in route: {key}")


def build_packet(game_slug: str, task: str) -> dict[str, object]:
    config = read_config()
    games = require_object(config.get("games"), "games")
    workflows = require_object(config.get("workflows"), "workflows")
    stage_config = require_object(config.get("stages"), "stages")
    global_skills = require_object(config.get("skills"), "skills")
    interfaces = require_object(config.get("interfaces"), "interfaces")

    if game_slug not in games:
        known = ", ".join(sorted(games))
        raise RoutingError(f"Unknown game '{game_slug}'. Configured routes: {known}")
    game = require_object(games[game_slug], f"games.{game_slug}")
    label = require_string(game.get("label"), f"games.{game_slug}.label")
    game_skills = require_object(game.get("skills"), f"games.{game_slug}.skills")

    workflow = require_string_list(workflows.get(task), f"workflows.{task}")
    stages: list[dict[str, object]] = []
    for stage_name in workflow:
        stage = require_object(stage_config.get(stage_name), f"stages.{stage_name}")
        skill_keys = require_string_list(stage.get("skill_keys"), f"stages.{stage_name}.skill_keys")
        stages.append(
            {
                "stage": stage_name,
                "purpose": require_string(stage.get("purpose"), f"stages.{stage_name}.purpose"),
                "skills": [select_skill(key, game_skills, global_skills) for key in skill_keys],
            }
        )

    interface_id = require_string(game.get("interface"), f"games.{game_slug}.interface")
    interface = require_object(interfaces.get(interface_id), f"interfaces.{interface_id}")
    packet: dict[str, object] = {
        "config_version": config.get("version"),
        "game": {"id": game_slug, "label": label},
        "task": task,
        "stages": stages,
        "interface": {
            "id": interface_id,
            "mode": require_string(interface.get("mode"), f"interfaces.{interface_id}.mode"),
            "availability": require_string(
                interface.get("availability"), f"interfaces.{interface_id}.availability"
            ),
            "operations": require_string_list(
                interface.get("operations"), f"interfaces.{interface_id}.operations"
            ),
            "verification": require_string(
                interface.get("verification"), f"interfaces.{interface_id}.verification"
            ),
        },
        "execution_note": (
            "This packet routes skills and describes capabilities; the host agent must check that "
            "the declared tools/environment are actually available before using them."
        ),
    }
    return packet


def main() -> int:
    parser = argparse.ArgumentParser(description="Interpret configured game-skill routes.")
    parser.add_argument("--game", required=True, help="Configured game route ID")
    parser.add_argument("--task", choices=("create", "revise", "playtest"), default="create")
    arguments = parser.parse_args()
    try:
        packet = build_packet(arguments.game, arguments.task)
    except RoutingError as error:
        print(f"skill-router: {error}", file=sys.stderr)
        return 2
    print(json.dumps(packet, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
