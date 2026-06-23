"""
Notebook-friendly port of the main_phase.js game mechanics.

The goal of this file is to keep the gameplay rules aligned with
js/main_phase.js while letting the notebook change the two universal policy
models interactively.
"""

from __future__ import annotations

import copy
import csv
import math
import os
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

try:
    from .universal_policy_model import (
        PolicyMemory,
        UniversalPolicyParams,
        coord_key,
        man_dist,
        remember_gold_value,
        step_toward,
        universal_policy,
    )
except ImportError:
    from universal_policy_model import (
        PolicyMemory,
        UniversalPolicyParams,
        coord_key,
        man_dist,
        remember_gold_value,
        step_toward,
        universal_policy,
    )


MODULE_DIR = Path(__file__).resolve().parent
REPO_ROOT = MODULE_DIR.parent
for cache_dir in (MODULE_DIR / ".matplotlib_cache", MODULE_DIR / ".cache"):
    cache_dir.mkdir(exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(MODULE_DIR / ".matplotlib_cache"))
os.environ.setdefault("XDG_CACHE_HOME", str(MODULE_DIR / ".cache"))


DEFAULT_MAX_MOVES_PER_TURN = 5
SCAN_RADIUS = 0
ALIEN_ATTACK_PROB = 0.50

MINE_INITIAL_VALUES = {"A": 20, "B": 10, "C": 5}
MINE_DECAY_AMOUNTS = ((1, 1 / 3), (2, 1 / 3), (5, 1 / 3))

OBSERVATION_MAPS = [
    "gridworld/middle_reward_middle_risk_01.csv",
    "gridworld/middle_reward_middle_risk_02.csv",
    "gridworld/middle_reward_middle_risk_03.csv",
]

MAIN_PHASE_MAPS = [
    "gridworld/middle_reward_middle_risk_04.csv",
    "gridworld/middle_reward_middle_risk_05.csv",
    "gridworld/middle_reward_middle_risk_06.csv",
    "gridworld/middle_reward_middle_risk_07.csv",
    "gridworld/middle_reward_middle_risk_08.csv",
    "gridworld/middle_reward_middle_risk_09.csv",
    "gridworld/middle_reward_middle_risk_10.csv",
    "gridworld/middle_reward_middle_risk_11.csv",
    "gridworld/middle_reward_middle_risk_12.csv",
    "gridworld/middle_reward_middle_risk_13.csv",
    "gridworld/middle_reward_middle_risk_14.csv",
    "gridworld/middle_reward_middle_risk_15.csv",
]


def clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


def cheb_dist(x1: int, y1: int, x2: int, y2: int) -> int:
    return max(abs(x1 - x2), abs(y1 - y2))


def parse_int_like(value: object, default: int = 0) -> int:
    text = str(value if value is not None else "").strip()
    if not text:
        return default
    try:
        return int(text)
    except ValueError:
        try:
            return int(float(text))
        except ValueError:
            return default


def mine_decay_key(mine_type_raw: object) -> str:
    text = str(mine_type_raw or "").upper()
    for key in ("A", "B", "C"):
        if key in text:
            return key
    return ""


def mine_decay_prob(mine_type_raw: object) -> float:
    return 0.5 if mine_decay_key(mine_type_raw) else 0.0


def initial_mine_value(mine_type_raw: object) -> int:
    return MINE_INITIAL_VALUES.get(mine_decay_key(mine_type_raw), 0)


def current_mine_value(tile_or_mine_type: object) -> int:
    if hasattr(tile_or_mine_type, "mine_value"):
        value = getattr(tile_or_mine_type, "mine_value", 0)
        try:
            return int(value)
        except (TypeError, ValueError):
            return initial_mine_value(getattr(tile_or_mine_type, "mine_type", ""))
    return initial_mine_value(tile_or_mine_type)


def reward_band_for_value(value: object) -> str:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return ""
    if 14 <= n <= 20:
        return "yellow"
    if 6 <= n <= 13:
        return "purple"
    if 0 <= n <= 5:
        return "blue"
    return ""


def mine_reward_options(mine_type_raw: object) -> Tuple[Tuple[int, float], ...]:
    key = mine_decay_key(mine_type_raw)
    return ((MINE_INITIAL_VALUES[key], 1.0),) if key else tuple()


def expected_mine_reward(tile_or_mine_type: object) -> float:
    return float(max(0, current_mine_value(tile_or_mine_type)))


def sample_mine_decay_amount(rng: random.Random) -> dict:
    u = rng.random()
    cumulative = 0.0
    for amount, prob in MINE_DECAY_AMOUNTS:
        cumulative += prob
        if u < cumulative:
            return {"decay_amount": amount, "decay_prob": prob, "decay_rng_u": u}
    amount, prob = MINE_DECAY_AMOUNTS[-1]
    return {"decay_amount": amount, "decay_prob": prob, "decay_rng_u": u}


def sample_mine_reward(tile_or_mine_type: object, rng: random.Random) -> dict:
    mine_type = getattr(tile_or_mine_type, "mine_type", tile_or_mine_type)
    key = mine_decay_key(mine_type)
    current_value = max(0, current_mine_value(tile_or_mine_type))
    decay = sample_mine_decay_amount(rng)
    value_after_decay = current_mine_value(tile_or_mine_type) - int(decay["decay_amount"])
    return {
        "mine_type_key": key,
        "reward_value": current_value,
        "reward_prob": 1.0 if key else 0.0,
        "reward_rng": None,
        "mine_initial_value": getattr(tile_or_mine_type, "mine_initial_value", initial_mine_value(mine_type)),
        "mine_value_before": current_mine_value(tile_or_mine_type),
        "mine_value_after": value_after_decay,
        "mine_decay_amount": decay["decay_amount"],
        "mine_reward_band": reward_band_for_value(current_value),
        "decay_prob": decay["decay_prob"],
        "decay_rng_u": decay["decay_rng_u"],
    }


@dataclass
class Tile:
    revealed: bool = False
    gold_mine: bool = False
    depleted_gold_mine_for_display: bool = False
    mine_type: str = ""
    mine_initial_value: int = 0
    mine_value: int = 0
    high_reward: bool = False
    alien_center_id: int = 0


@dataclass
class Alien:
    id: int
    x: int
    y: int
    discovered: bool = False
    removed: bool = False


@dataclass
class Agent:
    name: str
    cls: str
    x: int
    y: int
    tag: str = ""


@dataclass
class GameState:
    grid_size: int
    game_map: List[List[Tile]]
    aliens: List[Alien]
    agents: Dict[str, Agent]
    map_path: Path
    round_current: int = 1
    round_total: int = 15
    turn_order: Tuple[str, str] = ("security", "forager")
    turn_idx: int = 0
    moves_used: int = 0
    max_moves: int = DEFAULT_MAX_MOVES_PER_TURN
    gold_total: int = 0
    forager_stun_turns: int = 0
    scanned_cells: set = field(default_factory=set)
    policy_memory: Dict[str, PolicyMemory] = field(default_factory=dict)
    policy_alpha: Dict[str, dict] = field(default_factory=dict)
    event_log: List[dict] = field(default_factory=list)
    running: bool = True
    auto_recovered: bool = False

    def cur_key(self) -> str:
        return self.turn_order[self.turn_idx % len(self.turn_order)]

    def tile_at(self, x: int, y: int) -> Tile:
        return self.game_map[y][x]

    def alien_by_id(self, alien_id: int) -> Optional[Alien]:
        for alien in self.aliens:
            if alien.id == alien_id:
                return alien
        return None


@dataclass
class SimulationResult:
    state: GameState
    frames: List[dict]
    events: List[dict]

    def events_dataframe(self):
        import pandas as pd

        return pd.DataFrame(self.events)

    def animate(self, interval: int = 260, max_frames: Optional[int] = None, action_rows: int = 18):
        return animate_frames(self.frames, interval=interval, max_frames=max_frames, action_rows=action_rows)


def resolve_repo_path(path: object, repo_root: Path = REPO_ROOT) -> Path:
    p = Path(path)
    if p.is_absolute():
        return p
    return (repo_root / p).resolve()


def discover_maps(repo_root: Path = REPO_ROOT) -> List[Path]:
    grid_dir = repo_root / "gridworld"
    if not grid_dir.exists():
        return []
    return sorted(grid_dir.glob("*.csv"))


def available_main_phase_maps(repo_root: Path = REPO_ROOT) -> List[Path]:
    configured = [resolve_repo_path(p, repo_root) for p in MAIN_PHASE_MAPS]
    existing = [p for p in configured if p.exists()]
    return existing or discover_maps(repo_root)


def load_map_csv(map_path: object, repo_root: Path = REPO_ROOT) -> Tuple[int, List[dict]]:
    path = resolve_repo_path(map_path, repo_root)
    rows: List[dict] = []
    max_x = 0
    max_y = 0
    with path.open("r", newline="") as handle:
        reader = csv.DictReader(handle)
        needed = {"x", "y", "mine_type", "alien_id"}
        headers = {h.strip().lower() for h in (reader.fieldnames or [])}
        if not needed.issubset(headers):
            raise ValueError(f"{path} must have headers x,y,mine_type,alien_id")
        for row in reader:
            x = parse_int_like(row.get("x"), default=-1)
            y = parse_int_like(row.get("y"), default=-1)
            if x < 0 or y < 0:
                continue
            mine_type = str(row.get("mine_type") or "").strip()
            alien_id = parse_int_like(row.get("alien_id"), default=0)
            rows.append({"x": x, "y": y, "mine_type": mine_type, "alien_id": alien_id})
            max_x = max(max_x, x)
            max_y = max(max_y, y)
    return max(max_x, max_y) + 1, rows


def build_map_from_csv(grid_size: int, rows: Sequence[dict]) -> Tuple[List[List[Tile]], List[Alien]]:
    game_map = [[Tile() for _ in range(grid_size)] for _ in range(grid_size)]
    alien_centers: Dict[int, Alien] = {}
    for row in rows:
        x = int(row["x"])
        y = int(row["y"])
        if x < 0 or y < 0 or x >= grid_size or y >= grid_size:
            continue
        tile = game_map[y][x]
        mine_type = str(row.get("mine_type") or "").strip()
        if mine_type:
            tile.gold_mine = True
            tile.depleted_gold_mine_for_display = False
            tile.mine_type = mine_type
            tile.mine_initial_value = initial_mine_value(mine_type)
            tile.mine_value = tile.mine_initial_value
        alien_id = int(row.get("alien_id") or 0)
        if alien_id > 0:
            tile.alien_center_id = alien_id
            alien_centers[alien_id] = Alien(id=alien_id, x=x, y=y)

    for alien in alien_centers.values():
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                x = alien.x + dx
                y = alien.y + dy
                if 0 <= x < grid_size and 0 <= y < grid_size:
                    game_map[y][x].high_reward = True

    aliens = sorted(alien_centers.values(), key=lambda item: item.id)
    return game_map, aliens


def horizontal_spawn_positions(grid_size: int) -> dict:
    size = max(1, int(grid_size))
    y = (size - 1) // 2
    edge_offset = min(3, (size - 1) // 2)
    return {
        "forager": {"x": edge_offset, "y": y},
        "security": {"x": size - 1 - edge_offset, "y": y},
    }


def make_state_from_map(
    map_path: object,
    rounds: int = 15,
    max_moves: int = DEFAULT_MAX_MOVES_PER_TURN,
    repo_root: Path = REPO_ROOT,
) -> GameState:
    path = resolve_repo_path(map_path, repo_root)
    grid_size, rows = load_map_csv(path, repo_root=repo_root)
    game_map, aliens = build_map_from_csv(grid_size, rows)
    spawns = horizontal_spawn_positions(grid_size)
    state = GameState(
        grid_size=grid_size,
        game_map=game_map,
        aliens=aliens,
        agents={
            "forager": Agent("Forager", "forager", spawns["forager"]["x"], spawns["forager"]["y"], "F"),
            "security": Agent("Security", "security", spawns["security"]["x"], spawns["security"]["y"], "S"),
        },
        map_path=path,
        round_total=max(1, int(rounds)),
        max_moves=max(1, int(max_moves)),
    )
    reveal(state, "forager", spawns["forager"]["x"], spawns["forager"]["y"], "spawn")
    reveal(state, "security", spawns["security"]["x"], spawns["security"]["y"], "spawn")
    return state


def snapshot(state: GameState, event: str = "", active_agent: str = "", extra: Optional[dict] = None) -> dict:
    extra = dict(extra or {})
    return {
        "event": event,
        "active_agent": active_agent,
        "round": state.round_current,
        "round_total": state.round_total,
        "turn_global": state.turn_idx + 1,
        "turn_index_in_round": state.turn_idx % len(state.turn_order),
        "moves_used": state.moves_used,
        "max_moves": state.max_moves,
        "forager_x": state.agents["forager"].x,
        "forager_y": state.agents["forager"].y,
        "security_x": state.agents["security"].x,
        "security_y": state.agents["security"].y,
        "gold_total": state.gold_total,
        "forager_stun_turns": state.forager_stun_turns,
        "map_name": state.map_path.name,
        **extra,
    }


def clone_tiles_for_frame(state: GameState) -> List[List[dict]]:
    out = []
    for row in state.game_map:
        out_row = []
        for tile in row:
            out_row.append(
                {
                    "revealed": tile.revealed,
                    "gold_mine": tile.gold_mine,
                    "depleted": tile.depleted_gold_mine_for_display,
                    "mine_type": mine_decay_key(tile.mine_type),
                    "mine_initial_value": tile.mine_initial_value,
                    "mine_value": tile.mine_value,
                    "high_reward": tile.high_reward,
                    "alien_center_id": tile.alien_center_id,
                }
            )
        out.append(out_row)
    return out


def make_frame(state: GameState, label: str, active_agent: str = "", event: str = "") -> dict:
    return {
        "label": label,
        "event": event,
        "active_agent": active_agent,
        "grid_size": state.grid_size,
        "tiles": clone_tiles_for_frame(state),
        "aliens": [copy.deepcopy(alien.__dict__) for alien in state.aliens],
        "agents": {key: copy.deepcopy(agent.__dict__) for key, agent in state.agents.items()},
        "scanned_cells": set(state.scanned_cells),
        "round": state.round_current,
        "round_total": state.round_total,
        "turn": state.turn_idx + 1,
        "moves_used": state.moves_used,
        "max_moves": state.max_moves,
        "gold_total": state.gold_total,
        "forager_stun_turns": state.forager_stun_turns,
        "map_name": state.map_path.name,
        "policy_alpha": copy.deepcopy(state.policy_alpha),
    }


def log_event(state: GameState, event: str, active_agent: str = "", **extra) -> None:
    state.event_log.append(snapshot(state, event=event, active_agent=active_agent, extra=extra))


def reveal(state: GameState, agent_key: str, x: int, y: int, cause: str) -> bool:
    tile = state.tile_at(x, y)
    if tile.revealed:
        return False
    tile.revealed = True
    log_event(
        state,
        "tile_reveal",
        active_agent=agent_key,
        cause=cause,
        tile_x=x,
        tile_y=y,
        tile_gold_mine=int(tile.gold_mine),
        tile_mine_type=tile.mine_type,
        tile_mine_value=tile.mine_value,
        tile_high_reward=int(tile.high_reward),
        tile_alien_center_id=tile.alien_center_id,
    )
    return True


def get_scan_cells(state: GameState, cx: int, cy: int) -> List[dict]:
    if cx < 0 or cy < 0 or cx >= state.grid_size or cy >= state.grid_size:
        return []
    return [{"x": cx, "y": cy, "tile": state.tile_at(cx, cy)}]


def is_scan_mine_tile(tile: Tile) -> bool:
    return bool(tile and (tile.gold_mine or tile.depleted_gold_mine_for_display))


def can_scan_at(state: GameState, x: int, y: int) -> bool:
    if x < 0 or y < 0 or x >= state.grid_size or y >= state.grid_size:
        return False
    return is_scan_mine_tile(state.tile_at(x, y))


def mark_scanned_cells(state: GameState, scan_cells: Iterable[dict]) -> None:
    for point in scan_cells:
        state.scanned_cells.add(coord_key(point["x"], point["y"]))


def was_scanned_cell(state: GameState, x: int, y: int) -> bool:
    return coord_key(x, y) in state.scanned_cells


def find_aliens_in_scan_cells(state: GameState, scan_cells: Iterable[dict]) -> List[Alien]:
    seen = set()
    found: List[Alien] = []
    for point in scan_cells:
        alien_id = int(point["tile"].alien_center_id or 0)
        if not alien_id or alien_id in seen:
            continue
        seen.add(alien_id)
        alien = state.alien_by_id(alien_id)
        if alien and not alien.removed:
            found.append(alien)
    return found


def record_scan_without_mine_depletion(state: GameState, tile: Tile, x: int, y: int, cause: str) -> dict:
    if not tile or not tile.gold_mine:
        return {"depleted": False, "security_memory_depleted": False}
    key = mine_decay_key(tile.mine_type)
    value_before = current_mine_value(tile)
    return {
        "depleted": False,
        "security_memory_depleted": True,
        "tile_x": x,
        "tile_y": y,
        "mine_type_key": key,
        "mine_type_raw": tile.mine_type,
        "mine_initial_value": tile.mine_initial_value or initial_mine_value(tile.mine_type),
        "mine_value_before": value_before,
        "mine_value_after": value_before,
        "mine_decay_amount": 0,
        "mine_reward_band": reward_band_for_value(max(0, value_before)),
        "scan_memory_cause": cause,
    }


def update_security_memory_after_scan(state: GameState, scan_cells: Iterable[dict]) -> None:
    memory = state.policy_memory.setdefault("security", PolicyMemory())
    for point in scan_cells:
        key = coord_key(point["x"], point["y"])
        memory.chased.add(key)
        memory.chase_areas.add(key)


def any_alien_in_range(state: GameState, fx: int, fy: int) -> Optional[Alien]:
    for alien in state.aliens:
        if alien.removed:
            continue
        if cheb_dist(fx, fy, alien.x, alien.y) <= 1:
            return alien
    return None


def log_scanned_tile_blocks_attack(state: GameState, agent_key: str, attacker: Alien, x: int, y: int) -> None:
    log_event(
        state,
        "alien_attack_blocked_by_scan",
        active_agent=agent_key,
        attacker_alien_id=attacker.id,
        alien_x=attacker.x,
        alien_y=attacker.y,
        dig_x=x,
        dig_y=y,
        scanned_tile=1,
    )


def update_forager_memory_after_dig(state: GameState, x: int, y: int, reward_roll: dict) -> None:
    memory = state.policy_memory.setdefault("forager", PolicyMemory())
    observed_reward = float(reward_roll.get("reward_value", 0.0))
    next_value = max(0.0, float(reward_roll.get("mine_value_after", 0.0)))
    memory.total_reward += observed_reward
    memory.round_reward += observed_reward
    remember_gold_value(memory, x, y, next_value)


def get_security_recovery_path(state: GameState, start_x: int, start_y: int, target_x: int, target_y: int) -> List[dict]:
    path: List[dict] = []
    x = start_x
    y = start_y
    guard = max(1, state.grid_size * state.grid_size * 2)
    while (x != target_x or y != target_y) and guard > 0:
        act = step_toward(x, y, target_x, target_y)
        if not act:
            break
        to_x = clamp(x + int(act["dx"]), 0, state.grid_size - 1)
        to_y = clamp(y + int(act["dy"]), 0, state.grid_size - 1)
        path.append({**act, "from_x": x, "from_y": y, "to_x": to_x, "to_y": to_y})
        x, y = to_x, to_y
        guard -= 1
    return path


def advance_after_auto_stun_recovery(state: GameState, rounds_wasted: int) -> None:
    skip_rounds = max(1, int(rounds_wasted) if rounds_wasted else 1)
    order_len = len(state.turn_order)
    from_round = state.round_current
    current_round_start_idx = (state.turn_idx // order_len) * order_len
    state.turn_idx = current_round_start_idx + skip_rounds * order_len
    state.moves_used = 0
    state.round_current += skip_rounds
    state.auto_recovered = True
    log_event(
        state,
        "auto_stun_round_skip",
        auto_recovery=1,
        from_round=from_round,
        to_round=state.round_current,
        rounds_wasted=skip_rounds,
    )
    if state.round_current > state.round_total:
        state.running = False
        log_event(state, "game_end", reason="round_limit_after_auto_recovery")


def resolve_auto_stun_recovery(state: GameState, attacker: Optional[Alien], frames: List[dict]) -> None:
    forager = state.agents["forager"]
    security = state.agents["security"]
    security_start_x, security_start_y = security.x, security.y
    forager_x, forager_y = forager.x, forager.y
    path = get_security_recovery_path(state, security.x, security.y, forager.x, forager.y)
    security_distance = len(path)
    steps_required = security_distance + 2
    rounds_wasted = max(1, math.ceil(steps_required / max(1, state.max_moves)))
    security_path_tiles = "|".join(f"{step['to_x']},{step['to_y']}" for step in path)
    attacker_alien_id = attacker.id if attacker else 0

    for i, step in enumerate(path, start=1):
        security.x = step["to_x"]
        security.y = step["to_y"]
        reveal(state, "security", security.x, security.y, "auto_stun_recovery_move")
        log_event(
            state,
            "auto_stun_recovery_move",
            active_agent="security",
            auto_recovery=1,
            step_number=i,
            step_total=security_distance,
            dir=step.get("dir", ""),
            dx=step.get("dx", 0),
            dy=step.get("dy", 0),
            from_x=step["from_x"],
            from_y=step["from_y"],
            to_x=step["to_x"],
            to_y=step["to_y"],
            security_path_tiles=security_path_tiles,
        )
        frames.append(make_frame(state, "Security auto-recovers the Forager", "security", "auto_stun_recovery_move"))

    state.forager_stun_turns = 0
    recovery_scan_allowed = can_scan_at(state, forager.x, forager.y)
    scan_cells = get_scan_cells(state, forager.x, forager.y) if recovery_scan_allowed else []
    mark_scanned_cells(state, scan_cells)
    update_security_memory_after_scan(state, scan_cells)
    scan_depletion = (
        record_scan_without_mine_depletion(state, state.tile_at(forager.x, forager.y), forager.x, forager.y, "auto_stun_recovery")
        if recovery_scan_allowed
        else {"depleted": False, "security_memory_depleted": False}
    )

    found_aliens = find_aliens_in_scan_cells(state, scan_cells)
    newly_found = 0
    for alien in found_aliens:
        if not alien.discovered:
            newly_found += 1
        alien.discovered = True

    found_ids = [alien.id for alien in found_aliens]
    found_id = found_ids[0] if found_ids else attacker_alien_id
    log_event(
        state,
        "revive_forager",
        active_agent="security",
        success=1,
        key="auto",
        move_index_in_turn=1,
        auto_recovery=1,
        on_forager_tile=1,
        from_x=security_start_x,
        from_y=security_start_y,
        to_x=forager_x,
        to_y=forager_y,
        dx=forager_x - security_start_x,
        dy=forager_y - security_start_y,
        security_distance=security_distance,
        steps_required=steps_required,
        rounds_wasted=rounds_wasted,
        security_path_tiles=security_path_tiles,
        forager_stun_turns_after=0,
        attacker_alien_id=attacker_alien_id,
    )
    log_event(
        state,
        "scan_chase",
        active_agent="security",
        success=1,
        key="auto",
        move_index_in_turn=2,
        auto_recovery=1,
        scan_center_x=forager.x,
        scan_center_y=forager.y,
        scan_radius=SCAN_RADIUS,
        scan_allowed=int(recovery_scan_allowed),
        scanned_tile_count=len(scan_cells),
        scanned_tiles="|".join(coord_key(point["x"], point["y"]) for point in scan_cells),
        mine_depleted_by_scan=int(bool(scan_depletion.get("depleted"))),
        security_memory_depleted_by_scan=int(bool(scan_depletion.get("security_memory_depleted"))),
        has_alien=int(bool(found_aliens)),
        newly_found=newly_found,
        chased_away=int(bool(found_aliens)),
        found_alien_count=len(found_aliens),
        found_alien_id=found_id,
        found_alien_ids="|".join(str(alien_id) for alien_id in found_ids),
        tile_alien_center_id=state.tile_at(forager.x, forager.y).alien_center_id or 0,
        security_distance=security_distance,
        steps_required=steps_required,
        rounds_wasted=rounds_wasted,
        security_path_tiles=security_path_tiles,
        attacker_alien_id=attacker_alien_id,
    )

    for alien in found_aliens:
        alien.removed = True
        log_event(
            state,
            "alien_chased_away",
            active_agent="security",
            auto_recovery=1,
            reason="chased_away",
            chase_status="chased_away",
            alien_id=alien.id,
            found_alien_id=alien.id,
            found_alien_count=len(found_aliens),
            alien_x=alien.x,
            alien_y=alien.y,
            tile_x=alien.x,
            tile_y=alien.y,
            cause="auto_stun_recovery",
            scan_center_x=forager.x,
            scan_center_y=forager.y,
            scan_radius=SCAN_RADIUS,
        )

    log_event(
        state,
        "auto_stun_recovery",
        active_agent="security",
        auto_recovery=1,
        security_distance=security_distance,
        steps_required=steps_required,
        rounds_wasted=rounds_wasted,
        security_start_x=security_start_x,
        security_start_y=security_start_y,
        security_path_tiles=security_path_tiles,
        scan_center_x=forager.x,
        scan_center_y=forager.y,
        scan_radius=SCAN_RADIUS,
        scan_allowed=int(recovery_scan_allowed),
        scanned_tile_count=len(scan_cells),
        mine_depleted_by_scan=int(bool(scan_depletion.get("depleted"))),
        security_memory_depleted_by_scan=int(bool(scan_depletion.get("security_memory_depleted"))),
        found_alien_count=len(found_aliens),
        found_alien_id=found_id,
        found_alien_ids="|".join(str(alien_id) for alien_id in found_ids),
        attacker_alien_id=attacker_alien_id,
        alien_x=attacker.x if attacker else "",
        alien_y=attacker.y if attacker else "",
    )
    frames.append(make_frame(state, "Forager revived; local tile scanned", "security", "auto_stun_recovery"))
    advance_after_auto_stun_recovery(state, rounds_wasted)


def maybe_deplete_mine_at_tile(
    state: GameState,
    tile: Tile,
    x: int,
    y: int,
    rng: random.Random,
    frames: List[dict],
    reward_roll: Optional[dict] = None,
) -> dict:
    if not tile or not tile.gold_mine:
        return {"depleted": False}
    key = mine_decay_key(tile.mine_type)
    decay = reward_roll if reward_roll and "mine_decay_amount" in reward_roll else sample_mine_decay_amount(rng)
    value_before = current_mine_value(tile)
    value_after = value_before - int(decay["mine_decay_amount"] if "mine_decay_amount" in decay else decay["decay_amount"])
    payload = {
        "tile_x": x,
        "tile_y": y,
        "mine_type_key": key,
        "mine_type_raw": tile.mine_type,
        "decay_prob": float(decay.get("decay_prob", 0.5)),
        "rng_u": decay.get("decay_rng_u"),
        "decay_rng_u": decay.get("decay_rng_u"),
        "mine_initial_value": tile.mine_initial_value or initial_mine_value(tile.mine_type),
        "mine_value_before": value_before,
        "mine_value_after": value_after,
        "mine_decay_amount": int(decay["mine_decay_amount"] if "mine_decay_amount" in decay else decay["decay_amount"]),
        "mine_reward_band": reward_band_for_value(max(0, value_before)),
    }
    log_event(state, "mine_decay_check", **payload)
    tile.mine_value = value_after
    if value_after < 0:
        tile.depleted_gold_mine_for_display = True
        tile.gold_mine = False
        tile.mine_type = ""
        log_event(
            state,
            "gold_mine_depleted",
            **payload,
        )
        frames.append(make_frame(state, "Gold mine fully dug", event="gold_mine_depleted"))
        return {"depleted": True, **payload}
    log_event(state, "mine_not_depleted", **payload)
    return {"depleted": False, **payload}


def normalize_action_key_for_role(agent_key: str, key_lower: str) -> str:
    key = str(key_lower or "").lower()
    if agent_key == "forager" and key in ("d", "e"):
        return "d"
    if agent_key == "security" and key in ("s", "q"):
        return "s"
    if agent_key == "security" and key in ("r", "e"):
        return "r"
    return key


def attempt_move(state: GameState, agent_key: str, act: dict, frames: List[dict]) -> bool:
    agent = state.agents[agent_key]
    from_x, from_y = agent.x, agent.y
    attempted_x = from_x + int(act.get("dx", 0))
    attempted_y = from_y + int(act.get("dy", 0))
    to_x = clamp(attempted_x, 0, state.grid_size - 1)
    to_y = clamp(attempted_y, 0, state.grid_size - 1)
    clamped_flag = to_x != attempted_x or to_y != attempted_y
    if clamped_flag:
        log_event(
            state,
            "move_invalid",
            active_agent=agent_key,
            reason="out_of_bounds_move",
            from_x=from_x,
            from_y=from_y,
            attempted_x=attempted_x,
            attempted_y=attempted_y,
            to_x=to_x,
            to_y=to_y,
        )
        return False

    agent.x = to_x
    agent.y = to_y
    state.moves_used += 1
    log_event(
        state,
        "move",
        active_agent=agent_key,
        dir=act.get("dir", ""),
        dx=int(act.get("dx", 0)),
        dy=int(act.get("dy", 0)),
        from_x=from_x,
        from_y=from_y,
        to_x=to_x,
        to_y=to_y,
    )
    reveal(state, agent_key, to_x, to_y, "move")
    frames.append(make_frame(state, f"{agent_key.title()} moves {act.get('dir', '')}", agent_key, "move"))
    return True


def do_action(state: GameState, agent_key: str, key_lower: str, rng: random.Random, frames: List[dict]) -> bool:
    agent = state.agents[agent_key]
    tile = state.tile_at(agent.x, agent.y)
    action_key = normalize_action_key_for_role(agent_key, key_lower)

    if agent_key == "forager" and action_key == "d":
        if not (tile.revealed and tile.gold_mine):
            log_event(state, "dig_invalid", active_agent=agent_key, reason="no_gold_mine_here")
            return False
        reward_roll = sample_mine_reward(tile, rng)
        gold_delta = int(reward_roll["reward_value"])
        before = state.gold_total
        state.gold_total += gold_delta
        state.moves_used += 1
        log_event(
            state,
            "dig",
            active_agent=agent_key,
            success=1,
            gold_before=before,
            gold_after=state.gold_total,
            gold_delta=gold_delta,
            mine_type_key=reward_roll["mine_type_key"],
            mine_reward_prob=reward_roll["reward_prob"],
            mine_reward_rng=reward_roll["reward_rng"],
            mine_initial_value=reward_roll["mine_initial_value"],
            mine_value_before=reward_roll["mine_value_before"],
            mine_value_after=reward_roll["mine_value_after"],
            mine_decay_amount=reward_roll["mine_decay_amount"],
            mine_reward_band=reward_roll["mine_reward_band"],
            decay_prob=reward_roll["decay_prob"],
            decay_rng_u=reward_roll["decay_rng_u"],
            tile_x=agent.x,
            tile_y=agent.y,
        )
        frames.append(make_frame(state, f"Forager digs +{gold_delta} gold", agent_key, "dig"))
        maybe_deplete_mine_at_tile(state, tile, agent.x, agent.y, rng, frames, reward_roll)
        update_forager_memory_after_dig(state, agent.x, agent.y, reward_roll)

        attacker = any_alien_in_range(state, agent.x, agent.y)
        if attacker:
            if was_scanned_cell(state, agent.x, agent.y):
                log_scanned_tile_blocks_attack(state, agent_key, attacker, agent.x, agent.y)
                if state.moves_used >= state.max_moves:
                    end_turn(state, "auto_max_moves")
                return True
            u = rng.random()
            will_attack = u < ALIEN_ATTACK_PROB
            log_event(
                state,
                "alien_attack_check",
                active_agent=agent_key,
                attacker_alien_id=attacker.id,
                alien_x=attacker.x,
                alien_y=attacker.y,
                dig_x=agent.x,
                dig_y=agent.y,
                attack_prob=ALIEN_ATTACK_PROB,
                rng_u=u,
                will_attack=int(will_attack),
            )
            if will_attack:
                state.forager_stun_turns = max(state.forager_stun_turns, 3)
                log_event(
                    state,
                    "alien_attack",
                    active_agent=agent_key,
                    attacker_alien_id=attacker.id,
                    alien_x=attacker.x,
                    alien_y=attacker.y,
                    stun_turns_set=state.forager_stun_turns,
                )
                frames.append(make_frame(state, f"Alien {attacker.id} stuns the Forager", agent_key, "alien_attack"))
                resolve_auto_stun_recovery(state, attacker, frames)
        return True

    if agent_key == "security" and action_key == "s":
        if not is_scan_mine_tile(tile):
            log_event(state, "scan_chase_invalid", active_agent=agent_key, reason="no_gold_mine_here")
            return False
        scan_cells = get_scan_cells(state, agent.x, agent.y)
        mark_scanned_cells(state, scan_cells)
        update_security_memory_after_scan(state, scan_cells)
        found_aliens = find_aliens_in_scan_cells(state, scan_cells)
        scan_depletion = record_scan_without_mine_depletion(state, tile, agent.x, agent.y, "scan_chase")
        newly_found = 0
        for alien in found_aliens:
            if not alien.discovered:
                alien.discovered = True
                newly_found += 1
        state.moves_used += 1
        log_event(
            state,
            "scan_chase",
            active_agent=agent_key,
            success=1,
            scan_center_x=agent.x,
            scan_center_y=agent.y,
            scan_radius=SCAN_RADIUS,
            scanned_tile_count=len(scan_cells),
            mine_depleted_by_scan=int(bool(scan_depletion.get("depleted"))),
            security_memory_depleted_by_scan=int(bool(scan_depletion.get("security_memory_depleted"))),
            has_alien=int(bool(found_aliens)),
            newly_found=newly_found,
            chased_away=int(bool(found_aliens)),
            found_alien_count=len(found_aliens),
            found_alien_ids="|".join(str(alien.id) for alien in found_aliens),
        )
        for alien in found_aliens:
            if not alien.removed:
                alien.removed = True
                log_event(
                    state,
                    "alien_chased_away",
                    active_agent=agent_key,
                    alien_id=alien.id,
                    alien_x=alien.x,
                    alien_y=alien.y,
                    cause="scan_chase",
                )
        label = "Security scans and chases" if found_aliens else "Security scans: no alien"
        frames.append(make_frame(state, label, agent_key, "scan_chase"))
        return True

    if agent_key == "security" and action_key == "r":
        forager = state.agents["forager"]
        if not (state.forager_stun_turns > 0 and agent.x == forager.x and agent.y == forager.y):
            log_event(state, "revive_forager_invalid", active_agent=agent_key, reason="forager_not_down_or_not_same_tile")
            return False
        state.forager_stun_turns = 0
        state.moves_used += 1
        log_event(state, "revive_forager", active_agent=agent_key, success=1)
        frames.append(make_frame(state, "Security revives Forager", agent_key, "revive_forager"))
        return True

    log_event(state, "action_invalid", active_agent=agent_key, reason="unknown_action", key=action_key)
    return False


def end_turn(state: GameState, reason: str = "") -> None:
    log_event(state, "end_turn", active_agent=state.cur_key(), reason=reason, moves_used=state.moves_used)
    state.turn_idx += 1
    state.moves_used = 0
    if state.turn_idx % len(state.turn_order) == 0:
        log_event(state, "end_round", ended_round=state.round_current)
        state.round_current += 1
        if state.round_current > state.round_total:
            state.running = False
            log_event(state, "game_end", reason="all_rounds_complete")


def ensure_policy_memory(state: GameState, agent_key: str) -> PolicyMemory:
    memory = state.policy_memory.setdefault(agent_key, PolicyMemory())
    if not hasattr(memory, "stun_hotspots"):
        memory.stun_hotspots = set()
    if not hasattr(memory, "gold_value_estimates"):
        memory.gold_value_estimates = {}
    if not hasattr(memory, "security_departed_gold_discounts"):
        memory.security_departed_gold_discounts = {}
    return memory


def simulate_universal_pair(
    map_path: object,
    forager_params: Optional[UniversalPolicyParams] = None,
    security_params: Optional[UniversalPolicyParams] = None,
    rounds: int = 15,
    max_moves: int = DEFAULT_MAX_MOVES_PER_TURN,
    seed: int = 7,
    repo_root: Path = REPO_ROOT,
    max_policy_steps: int = 10000,
) -> SimulationResult:
    rng = random.Random(int(seed))
    forager_params = forager_params or UniversalPolicyParams(lambda_value=0.0)
    security_params = security_params or UniversalPolicyParams(lambda_value=0.0)
    state = make_state_from_map(map_path, rounds=rounds, max_moves=max_moves, repo_root=repo_root)
    frames = [make_frame(state, "Spawn tiles revealed", event="spawn")]
    log_event(state, "simulation_start")

    policy_steps = 0
    while state.running and policy_steps < max_policy_steps:
        agent_key = state.cur_key()
        if state.forager_stun_turns > 0:
            resolve_auto_stun_recovery(state, None, frames)
            if state.auto_recovered:
                state.auto_recovered = False
            continue

        current_turn_idx = state.turn_idx
        while state.running and state.turn_idx == current_turn_idx and state.moves_used < state.max_moves:
            params = forager_params if agent_key == "forager" else security_params
            ensure_policy_memory(state, agent_key)
            act = universal_policy(
                state,
                agent_key,
                params,
                rng,
                scan_cells_fn=get_scan_cells,
            )
            policy_steps += 1
            if not act:
                break
            if act.get("kind") == "move":
                consumed = attempt_move(state, agent_key, act, frames)
            elif act.get("kind") == "action":
                consumed = do_action(state, agent_key, str(act.get("key", "")), rng, frames)
            else:
                consumed = False

            if state.auto_recovered:
                state.auto_recovered = False
                break
            if not consumed:
                break
            if state.running and state.turn_idx == current_turn_idx and state.moves_used >= state.max_moves:
                end_turn(state, "auto_max_moves")
                break

        if state.running and state.turn_idx == current_turn_idx:
            end_turn(state, "scripted_turn_complete")

    if policy_steps >= max_policy_steps:
        state.running = False
        log_event(state, "game_end", reason="max_policy_steps_reached")

    return SimulationResult(state=state, frames=frames, events=state.event_log)


def render_frame(ax, frame: dict) -> None:
    import matplotlib.patches as patches

    ax.clear()
    n = frame["grid_size"]
    ax.set_xlim(0, n)
    ax.set_ylim(n, 0)
    ax.set_aspect("equal")
    ax.set_xticks(range(n + 1))
    ax.set_yticks(range(n + 1))
    ax.grid(color="#d9d9d9", linewidth=0.8)
    ax.tick_params(left=False, bottom=False, labelleft=False, labelbottom=False)

    for y, row in enumerate(frame["tiles"]):
        for x, tile in enumerate(row):
            face = "#ffffff" if tile["revealed"] else "#bdbdbd"
            ax.add_patch(patches.Rectangle((x, y), 1, 1, facecolor=face, edgecolor="#eeeeee", linewidth=0.8))
            if coord_key(x, y) in frame["scanned_cells"]:
                ax.add_patch(patches.Rectangle((x + 0.05, y + 0.05), 0.90, 0.90, fill=False, edgecolor="#22a06b", linewidth=1.8))

    agents = frame["agents"]
    forager = agents["forager"]
    security = agents["security"]
    same_tile = forager["x"] == security["x"] and forager["y"] == security["y"]
    if same_tile:
        ax.add_patch(patches.Circle((forager["x"] + 0.36, forager["y"] + 0.36), 0.20, facecolor="#16a34a", edgecolor="#065f46", linewidth=1.2))
        ax.add_patch(patches.Circle((security["x"] + 0.64, security["y"] + 0.64), 0.20, facecolor="#eab308", edgecolor="#854d0e", linewidth=1.2))
        ax.text(forager["x"] + 0.36, forager["y"] + 0.36, "F", ha="center", va="center", fontsize=8, weight="bold", color="#ffffff")
        ax.text(security["x"] + 0.64, security["y"] + 0.64, "S", ha="center", va="center", fontsize=8, weight="bold", color="#111111")
    else:
        f_color = "#9ca3af" if frame["forager_stun_turns"] > 0 else "#16a34a"
        ax.add_patch(patches.Circle((forager["x"] + 0.5, forager["y"] + 0.5), 0.27, facecolor=f_color, edgecolor="#065f46", linewidth=1.2))
        ax.text(forager["x"] + 0.5, forager["y"] + 0.5, "F", ha="center", va="center", fontsize=9, weight="bold", color="#ffffff")
        ax.add_patch(patches.Circle((security["x"] + 0.5, security["y"] + 0.5), 0.27, facecolor="#eab308", edgecolor="#854d0e", linewidth=1.2))
        ax.text(security["x"] + 0.5, security["y"] + 0.5, "S", ha="center", va="center", fontsize=9, weight="bold", color="#111111")

    mine_colors = {"A": "#f6c344", "B": "#9f7aea", "C": "#4f83cc", "": "#ffffff"}
    for y, row in enumerate(frame["tiles"]):
        for x, tile in enumerate(row):
            if tile["revealed"] and tile["gold_mine"]:
                key = tile["mine_type"]
                ax.add_patch(patches.Circle((x + 0.5, y + 0.5), 0.28, facecolor=mine_colors.get(key, "#f6c344"), edgecolor="#5b4a16", linewidth=1.1))
                ax.text(x + 0.5, y + 0.5, key, ha="center", va="center", fontsize=8, weight="bold", color="#111111")
            elif tile["revealed"] and tile["depleted"]:
                ax.add_patch(patches.Circle((x + 0.5, y + 0.5), 0.25, facecolor="#d8d8d8", edgecolor="#777777", linewidth=1.0))
                ax.text(x + 0.5, y + 0.5, "x", ha="center", va="center", fontsize=8, weight="bold", color="#555555")

    for alien in frame["aliens"]:
        if alien["removed"] or not alien["discovered"]:
            continue
        ax.add_patch(patches.RegularPolygon((alien["x"] + 0.5, alien["y"] + 0.5), numVertices=6, radius=0.25, facecolor="#a855f7", edgecolor="#5b21b6"))
        ax.text(alien["x"] + 0.5, alien["y"] + 0.5, str(alien["id"]), ha="center", va="center", fontsize=8, weight="bold", color="#ffffff")

    alpha_bits = []
    for role in ("forager", "security"):
        info = frame.get("policy_alpha", {}).get(role)
        if info and "alpha" in info:
            alpha_bits.append(f"{role[0].upper()} alpha={info['alpha']:.2f}")
    alpha_text = " | ".join(alpha_bits)
    title = (
        f"{frame['map_name']} | Round {frame['round']}/{frame['round_total']} | "
        f"Gold {frame['gold_total']} | Moves {frame['moves_used']}/{frame['max_moves']}\n"
        f"{frame['label']}"
    )
    if alpha_text:
        title += f"\n{alpha_text}"
    ax.set_title(title, fontsize=11)


def action_summary(frame: dict, index: int) -> str:
    agent = frame.get("active_agent") or "-"
    event = frame.get("event") or "state"
    label = frame.get("label") or event
    return f"{index + 1:03d}. R{frame.get('round')} {agent}: {label} [{event}]"


def render_action_panel(ax, frames: List[dict], current_index: int, action_rows: int = 18) -> None:
    import matplotlib.patches as patches
    import textwrap

    ax.clear()
    ax.axis("off")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.text(0.02, 0.98, "Actions", ha="left", va="top", fontsize=13, weight="bold")

    rows = max(4, int(action_rows or 18))
    start = max(0, current_index - rows + 1)
    visible = frames[start : current_index + 1]
    y = 0.92
    row_height = min(0.85 / rows, 0.058)

    for offset, frame in enumerate(visible):
        frame_index = start + offset
        is_current = frame_index == current_index
        if is_current:
            ax.add_patch(
                patches.Rectangle(
                    (0.01, y - row_height + 0.004),
                    0.98,
                    row_height,
                    facecolor="#fff7cc",
                    edgecolor="#eab308",
                    linewidth=0.8,
                )
            )
        wrapped = textwrap.wrap(action_summary(frame, frame_index), width=42)
        ax.text(
            0.03,
            y,
            "\n".join(wrapped[:2]),
            ha="left",
            va="top",
            fontsize=8.5,
            color="#111111" if is_current else "#444444",
            weight="bold" if is_current else "normal",
        )
        y -= row_height

    ax.text(
        0.02,
        0.02,
        f"Frame {current_index + 1} / {len(frames)}",
        ha="left",
        va="bottom",
        fontsize=9,
        color="#666666",
    )


def animate_frames(frames: List[dict], interval: int = 260, max_frames: Optional[int] = None, action_rows: int = 18):
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation

    shown = frames[: max_frames or len(frames)]
    fig, (board_ax, action_ax) = plt.subplots(
        1,
        2,
        figsize=(11.4, 7.6),
        gridspec_kw={"width_ratios": [3.2, 1.45]},
    )

    def update(i):
        render_frame(board_ax, shown[i])
        render_action_panel(action_ax, shown, i, action_rows=action_rows)
        return []

    ani = FuncAnimation(fig, update, frames=len(shown), interval=interval, repeat=False)
    plt.close(fig)
    return ani


def display_simulation(result: SimulationResult, frame_ms: int = 260, action_rows: int = 18, max_frames: Optional[int] = None):
    try:
        from IPython.display import HTML, display
    except ModuleNotFoundError:
        print("Display unavailable: IPython is not installed in this Python environment.")
        return None

    try:
        animation = result.animate(interval=frame_ms, max_frames=max_frames, action_rows=action_rows)
    except ModuleNotFoundError as exc:
        if exc.name != "matplotlib":
            raise
        display(
            HTML(
                "<p><strong>Animation unavailable:</strong> the simulation ran, "
                "but this Python environment does not have matplotlib installed.</p>"
            )
        )
        return None

    display(HTML(animation.to_jshtml()))
    return animation


__all__ = [
    "UniversalPolicyParams",
    "SimulationResult",
    "available_main_phase_maps",
    "discover_maps",
    "simulate_universal_pair",
    "animate_frames",
    "display_simulation",
]
