"""
Universal policy model used by the main-phase simulator.

This file intentionally contains the tunable model calculation only. The game
environment passes in the current state and reward/scan helpers, so the
main-phase gameplay rules can stay separate from the policy math.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence


@dataclass
class UniversalPolicyParams:
    lambda_value: float = 0.0
    info_reward_tradeoff: float = 0.05
    epsilon: float = 20.0
    beta: float = 0.25
    chase_wt_drop: float = 0.25
    vdig_vmove_tradeoff: float = 0.70
    reward_total_decay: float = 0.5
    reward_info: float = 0.9


@dataclass
class PolicyMemory:
    visited: set = field(default_factory=set)
    prev: Optional[dict] = None
    chased: set = field(default_factory=set)
    chase_areas: set = field(default_factory=set)
    total_reward: float = 0.0
    round_reward: float = 0.0
    t: int = 0
    alpha: float = 0.0
    vdig: float = 0.0
    vmove: float = 0.0
    vscan: float = 0.0


def coord_key(x: int, y: int) -> str:
    return f"{x},{y}"


def man_dist(x1: int, y1: int, x2: int, y2: int) -> int:
    return abs(x1 - x2) + abs(y1 - y2)


def sgn(v: int) -> int:
    return 1 if v > 0 else -1 if v < 0 else 0


def step_toward(from_x: int, from_y: int, to_x: int, to_y: int) -> Optional[dict]:
    dx = to_x - from_x
    dy = to_y - from_y
    if dx == 0 and dy == 0:
        return None
    if abs(dx) >= abs(dy):
        sx = sgn(dx)
        return {"kind": "move", "dx": sx, "dy": 0, "dir": "right" if sx > 0 else "left"}
    sy = sgn(dy)
    return {"kind": "move", "dx": 0, "dy": sy, "dir": "down" if sy > 0 else "up"}


def softmax_choice(values: Sequence[float], temperature: float = 0.5) -> List[float]:
    if not values:
        return []
    temp = max(float(temperature), 1e-9)
    scaled = [float(value) / temp for value in values]
    max_val = max(scaled)
    exps = [math.exp(value - max_val) for value in scaled]
    total = sum(exps)
    return [value / total for value in exps]


def sample_index(probs: Sequence[float], rng: random.Random) -> int:
    r = rng.random()
    for i, prob in enumerate(probs):
        r -= prob
        if r <= 0:
            return i
    return len(probs) - 1


def sample_choice(labels: Sequence[str], scores: Sequence[float], rng: random.Random, temperature: float = 0.5) -> str:
    probs = softmax_choice(scores, temperature)
    return labels[sample_index(probs, rng)]


def neighbors(state, x: int, y: int) -> List[dict]:
    points = [{"x": x - 1, "y": y}, {"x": x + 1, "y": y}, {"x": x, "y": y - 1}, {"x": x, "y": y + 1}]
    return [p for p in points if 0 <= p["x"] < state.grid_size and 0 <= p["y"] < state.grid_size]


def default_scan_cells(state, cx: int, cy: int) -> List[dict]:
    if cx < 0 or cy < 0 or cx >= state.grid_size or cy >= state.grid_size:
        return []
    return [{"x": cx, "y": cy, "tile": state.tile_at(cx, cy)}]


def universal_policy(
    state,
    role: str,
    params: UniversalPolicyParams,
    rng: random.Random,
    expected_reward_fn: Callable[[object], float],
    scan_cells_fn: Optional[Callable[[object, int, int], List[dict]]] = None,
) -> Optional[dict]:
    agent_key = "security" if "security" in str(role).lower() else "forager"
    self_agent = state.agents[agent_key]
    other = state.agents["forager" if agent_key == "security" else "security"]
    scan_cells_fn = scan_cells_fn or default_scan_cells

    lam = float(params.lambda_value)
    eps = float(params.epsilon)
    y_t = 2.0
    reward_total_decay = float(params.reward_total_decay)
    vdig_vmove_tradeoff = float(params.vdig_vmove_tradeoff)
    reward_info = float(params.reward_info)

    memory = state.policy_memory.setdefault(agent_key, PolicyMemory())
    current_key = coord_key(self_agent.x, self_agent.y)
    memory.visited.add(current_key)

    def set_alpha(alpha: float, **extra) -> None:
        memory.alpha = alpha
        state.policy_alpha[agent_key] = {
            "alpha": alpha,
            **extra,
            "x": self_agent.x,
            "y": self_agent.y,
            "role": agent_key,
        }

    def reward_observed(x: int, y: int) -> float:
        tile = state.tile_at(x, y)
        if not (tile and tile.revealed and tile.gold_mine):
            return 0.0
        return expected_reward_fn(tile.mine_type)
    
    def reward_total(point: dict) -> float:
        total = 0.0
        for y in range(state.grid_size):
            for x in range(state.grid_size):
                reward = reward_observed(x, y)
                if reward <= 0:
                    continue
                dist = man_dist(point["x"], point["y"], x, y)
                total += reward_total_decay ** dist
        return total
    
    def unexplored_total() -> int:
        total = 0
        for y in range(state.grid_size):
            for x in range(state.grid_size):
                if not state.tile_at(x, y).revealed:
                    total += 1
        return total

    def can_universal_policy_scan_at(x: int, y: int) -> bool:
        tile = state.tile_at(x, y)
        return bool(tile and tile.gold_mine)

    def choose_move_by_softmax() -> Optional[dict]:
        positions = []
        scores = []
        for point in neighbors(state, self_agent.x, self_agent.y):
            dist = man_dist(point["x"], point["y"], other.x, other.y)
            reward_total_value = reward_total(point)
            unexplored_total_value = unexplored_total()

            score = (lam * y_t * math.exp(dist)) + (reward_info * y_t * reward_total_value) + ((1 - reward_info) * (y_t/4) * unexplored_total_value)
            positions.append(point)
            scores.append(eps * score)

        if not positions:
            return None
        probs = softmax_choice(scores, 1.0 if agent_key == "security" else 0.5)
        return positions[sample_index(probs, rng)]

    def finish_move() -> Optional[dict]:
        best = choose_move_by_softmax()
        memory.prev = {"x": self_agent.x, "y": self_agent.y}
        memory.t += 1
        return step_toward(self_agent.x, self_agent.y, best["x"], best["y"]) if best else None

    def finish_action(act: dict) -> dict:
        memory.prev = {"x": self_agent.x, "y": self_agent.y}
        memory.t += 1
        return act

    if agent_key == "forager":
        if state.forager_stun_turns > 0:
            memory.t += 1
            set_alpha(0.0, Vdig=float("nan"), Vmove=float("nan"), stunned=True)
            return None

        vdig = reward_observed(self_agent.x, self_agent.y)
        vmove = memory.round_reward / memory.t if memory.t > 0 else 0.0
        alpha = vdig - vmove
        memory.vdig = vdig
        memory.vmove = vmove
        set_alpha(alpha, Vdig=vdig, Vmove=vmove)

        action = sample_choice(
            ["dig", "move"],
            [eps * vdig_vmove_tradeoff * vdig, eps * (1 - vdig_vmove_tradeoff) * vmove],
            rng,
            0.5,
        )
        if action == "dig":
            here = state.tile_at(self_agent.x, self_agent.y)
            if here.revealed and here.gold_mine:
                reward = reward_observed(self_agent.x, self_agent.y)
                memory.total_reward += reward
                memory.round_reward += reward
                return finish_action({"kind": "action", "key": "d"})
        return finish_move()

    if agent_key == "security":
        if state.forager_stun_turns > 0:
            if self_agent.x == other.x and self_agent.y == other.y:
                set_alpha(0.0, rescue=True)
                return finish_action({"kind": "action", "key": "r"})
            set_alpha(0.0, rescue=True)
            memory.prev = {"x": self_agent.x, "y": self_agent.y}
            memory.t += 1
            return step_toward(self_agent.x, self_agent.y, other.x, other.y)

        scan_allowed_here = can_universal_policy_scan_at(self_agent.x, self_agent.y)
        vscan = reward_observed(self_agent.x, self_agent.y)
        for point in neighbors(state, self_agent.x, self_agent.y):
            dist = man_dist(point["x"], point["y"], other.x, other.y)
        vmove = math.exp(dist) * ((1-lam)/2)
        alpha = vscan - vmove
        memory.vscan = vscan
        memory.vmove = vmove
        set_alpha(
            alpha,
            Vscan=vscan,
            Vmove=vmove,
            stunHotspot=current_key in memory.stun_hotspots,
            scanAllowedHere=scan_allowed_here,
        )

        if scan_allowed_here:
            action = sample_choice(["chase", "move"], [eps * vscan, eps * vmove], rng, 1.0)
            if action == "chase" and current_key not in memory.chased:
                memory.chased.add(current_key)
                for point in scan_cells_fn(state, self_agent.x, self_agent.y):
                    memory.chase_areas.add(coord_key(point["x"], point["y"]))
                return finish_action({"kind": "action", "key": "s"})
        return finish_move()

    return None


__all__ = [
    "PolicyMemory",
    "UniversalPolicyParams",
    "coord_key",
    "man_dist",
    "neighbors",
    "softmax_choice",
    "step_toward",
    "universal_policy",
]