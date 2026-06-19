"""
Universal policy model used by the main-phase simulator.

This file contains only the model math. The simulator owns the game mechanics
such as reward sampling, mine depletion, stun recovery, and frame/event logs.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence, Tuple


@dataclass
class UniversalPolicyParams:
    lambda_value: float = 0.0
    epsilon: float = 20.0
    vdig_vmove_tradeoff: float = 0.70
    reward_total_decay: float = 0.5
    reward_info: float = 0.9
    forager_gold_prior: float = 10.0
    fixed_scan_value: float = 10.0
    follower_distance_target: float = 3.0
    leader_distance_cutoff: float = 6.0
    security_departed_gold_discount: float = 0.35


@dataclass
class PolicyMemory:
    visited: set = field(default_factory=set)
    prev: Optional[dict] = None
    chased: set = field(default_factory=set)
    chase_areas: set = field(default_factory=set)
    stun_hotspots: set = field(default_factory=set)
    gold_value_estimates: dict = field(default_factory=dict)
    security_departed_gold_discounts: dict = field(default_factory=dict)
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
    points = [
        {"x": x - 1, "y": y},
        {"x": x + 1, "y": y},
        {"x": x, "y": y - 1},
        {"x": x, "y": y + 1},
    ]
    return [p for p in points if 0 <= p["x"] < state.grid_size and 0 <= p["y"] < state.grid_size]


def default_scan_cells(state, cx: int, cy: int) -> List[dict]:
    if cx < 0 or cy < 0 or cx >= state.grid_size or cy >= state.grid_size:
        return []
    return [{"x": cx, "y": cy, "tile": state.tile_at(cx, cy)}]


def is_active_revealed_gold(state, x: int, y: int) -> bool:
    tile = state.tile_at(x, y)
    return bool(tile and tile.revealed and tile.gold_mine)


def learned_gold_value(memory: PolicyMemory, x: int, y: int) -> Optional[float]:
    estimates = getattr(memory, "gold_value_estimates", {})
    key = coord_key(x, y)
    if key not in estimates:
        return None
    return float(estimates[key])


def remember_gold_value(memory: PolicyMemory, x: int, y: int, value: float) -> float:
    if not hasattr(memory, "gold_value_estimates"):
        memory.gold_value_estimates = {}
    remembered_value = max(0.0, float(value))
    memory.gold_value_estimates[coord_key(x, y)] = remembered_value
    return remembered_value


def is_security_scanned_gold(memory: PolicyMemory, x: int, y: int) -> bool:
    return coord_key(x, y) in getattr(memory, "chased", set())


def security_departed_gold_discount(memory: PolicyMemory, x: int, y: int) -> float:
    discounts = getattr(memory, "security_departed_gold_discounts", {})
    return float(discounts.get(coord_key(x, y), 1.0))


def remember_security_departed_gold_discount(memory: PolicyMemory, x: int, y: int, discount: float) -> float:
    if not hasattr(memory, "security_departed_gold_discounts"):
        memory.security_departed_gold_discounts = {}
    key = coord_key(x, y)
    bounded_discount = min(1.0, max(0.0, float(discount)))
    current_discount = float(memory.security_departed_gold_discounts.get(key, 1.0))
    memory.security_departed_gold_discounts[key] = min(current_discount, bounded_discount)
    return memory.security_departed_gold_discounts[key]


def gold_value_details_at(
    state,
    memory: PolicyMemory,
    params: UniversalPolicyParams,
    agent_key: str,
    x: int,
    y: int,
) -> Tuple[float, str]:
    if not is_active_revealed_gold(state, x, y):
        return 0.0, "none"
    if agent_key == "security":
        if is_security_scanned_gold(memory, x, y):
            return 0.0, "security_memory_depleted"
        return float(params.fixed_scan_value), "fixed_scan_value"
    learned_value = learned_gold_value(memory, x, y)
    if learned_value is not None:
        return learned_value, "memory"
    return float(params.forager_gold_prior), "prior"


def gold_value_at(state, memory: PolicyMemory, params: UniversalPolicyParams, agent_key: str, x: int, y: int) -> float:
    value, _ = gold_value_details_at(state, memory, params, agent_key, x, y)
    return value


def visible_gold_targets(
    state,
    memory: PolicyMemory,
    params: UniversalPolicyParams,
    agent_key: str,
    exclude_key: Optional[str] = None,
    discount_key: Optional[str] = None,
    discount_multiplier: float = 1.0,
) -> List[dict]:
    targets = []
    for y in range(state.grid_size):
        for x in range(state.grid_size):
            if exclude_key and coord_key(x, y) == exclude_key:
                continue
            value, value_source = gold_value_details_at(state, memory, params, agent_key, x, y)
            if agent_key == "security" and value > 0:
                memory_discount = security_departed_gold_discount(memory, x, y)
                one_step_discount = min(1.0, max(0.0, float(discount_multiplier))) if coord_key(x, y) == discount_key else 1.0
                total_discount = memory_discount * one_step_discount
                if total_discount < 1.0:
                    value *= total_discount
                    value_source = "security_departed_discount"
            if value > 0:
                targets.append({"x": x, "y": y, "value": value, "valueSource": value_source})
    return targets


def best_visible_gold_value(
    state,
    memory: PolicyMemory,
    params: UniversalPolicyParams,
    agent_key: str,
    point: Optional[dict],
    exclude_key: Optional[str] = None,
    distance_extra: int = 0,
    discount_key: Optional[str] = None,
    discount_multiplier: float = 1.0,
) -> Tuple[float, Optional[dict]]:
    if not point:
        return 0.0, None
    best_value = 0.0
    best_target = None
    for target in visible_gold_targets(state, memory, params, agent_key, exclude_key, discount_key, discount_multiplier):
        dist = man_dist(point["x"], point["y"], target["x"], target["y"]) + max(0, int(distance_extra))
        value = target["value"] * (float(params.reward_total_decay) ** dist)
        if value > best_value:
            best_value = value
            best_target = target
    return best_value, best_target


def unexplored_total(state, params: UniversalPolicyParams, point: dict) -> float:
    total = 0.0
    decay = float(params.reward_total_decay)
    for y in range(state.grid_size):
        for x in range(state.grid_size):
            if state.tile_at(x, y).revealed:
                continue
            dist = man_dist(point["x"], point["y"], x, y)
            total += decay ** dist
    return total


def social_distance_value(point: dict, other, params: UniversalPolicyParams) -> float:
    """Return a social penalty; the lambda sign chooses which distance side is active."""
    lam = float(params.lambda_value)
    if lam == 0:
        return 0.0
    dist = man_dist(point["x"], point["y"], other.x, other.y)
    target = float(params.leader_distance_cutoff if lam > 0 else params.follower_distance_target)
    target = max(target, 1e-9)
    violation = max(0.0, target - dist) if lam > 0 else max(0.0, dist - target)
    scaled_penalty = (math.exp(violation) - 1.0) / (math.exp(target) - 1.0)
    return -abs(lam) * scaled_penalty


def movement_utility(
    state,
    memory: PolicyMemory,
    params: UniversalPolicyParams,
    agent_key: str,
    other,
    point: dict,
    exclude_gold_key: Optional[str] = None,
    gold_weight: Optional[float] = None,
    gold_distance_extra: int = 0,
    discount_gold_key: Optional[str] = None,
    discount_gold_multiplier: float = 1.0,
) -> float:
    gold_value, _ = best_visible_gold_value(
        state,
        memory,
        params,
        agent_key,
        point,
        exclude_gold_key,
        gold_distance_extra,
        discount_gold_key,
        discount_gold_multiplier,
    )
    explore_value = unexplored_total(state, params, point)
    visible_gold_weight = float(params.reward_info if gold_weight is None else gold_weight)
    return (
        social_distance_value(point, other, params)
        + visible_gold_weight * gold_value
        + (1 - float(params.reward_info)) * explore_value
    )


def score_neighbor_moves(
    state,
    memory: PolicyMemory,
    params: UniversalPolicyParams,
    agent_key: str,
    self_agent,
    other,
    exclude_gold_key: Optional[str] = None,
    gold_weight: Optional[float] = None,
    gold_distance_extra: int = 0,
    discount_gold_key: Optional[str] = None,
    discount_gold_multiplier: float = 1.0,
) -> List[Tuple[float, dict]]:
    return [
        (
            movement_utility(
                state,
                memory,
                params,
                agent_key,
                other,
                point,
                exclude_gold_key,
                gold_weight,
                gold_distance_extra,
                discount_gold_key,
                discount_gold_multiplier,
            ),
            point,
        )
        for point in neighbors(state, self_agent.x, self_agent.y)
    ]


def best_neighbor_move(
    state,
    memory: PolicyMemory,
    params: UniversalPolicyParams,
    agent_key: str,
    self_agent,
    other,
    exclude_gold_key: Optional[str] = None,
    gold_weight: Optional[float] = None,
    gold_distance_extra: int = 0,
    discount_gold_key: Optional[str] = None,
    discount_gold_multiplier: float = 1.0,
) -> Tuple[float, Optional[dict], Optional[dict]]:
    scored_moves = score_neighbor_moves(
        state,
        memory,
        params,
        agent_key,
        self_agent,
        other,
        exclude_gold_key,
        gold_weight,
        gold_distance_extra,
        discount_gold_key,
        discount_gold_multiplier,
    )
    if not scored_moves:
        return 0.0, None, None
    best_score, best_point = max(scored_moves, key=lambda item: item[0])
    if gold_weight is not None and gold_weight <= 0:
        return best_score, best_point, None
    _, target = best_visible_gold_value(
        state,
        memory,
        params,
        agent_key,
        best_point,
        exclude_gold_key,
        gold_distance_extra,
        discount_gold_key,
        discount_gold_multiplier,
    )
    return best_score, best_point, target


def choose_move_target(
    state,
    memory: PolicyMemory,
    params: UniversalPolicyParams,
    agent_key: str,
    self_agent,
    other,
    rng: random.Random,
    exclude_gold_key: Optional[str] = None,
    gold_weight: Optional[float] = None,
    gold_distance_extra: int = 0,
    discount_gold_key: Optional[str] = None,
    discount_gold_multiplier: float = 1.0,
) -> Optional[dict]:
    scored_moves = score_neighbor_moves(
        state,
        memory,
        params,
        agent_key,
        self_agent,
        other,
        exclude_gold_key,
        gold_weight,
        gold_distance_extra,
        discount_gold_key,
        discount_gold_multiplier,
    )
    if not scored_moves:
        return None
    scores = [float(params.epsilon) * score for score, _ in scored_moves]
    temperature = 1.0 if agent_key == "security" else 0.5
    probs = softmax_choice(scores, temperature)
    return scored_moves[sample_index(probs, rng)][1]


def remember_policy_step(memory: PolicyMemory, self_agent) -> None:
    memory.prev = {"x": self_agent.x, "y": self_agent.y}
    memory.t += 1


def set_policy_alpha(state, memory: PolicyMemory, agent_key: str, self_agent, alpha: float, **extra) -> None:
    memory.alpha = alpha
    state.policy_alpha[agent_key] = {
        "alpha": alpha,
        **extra,
        "x": self_agent.x,
        "y": self_agent.y,
        "role": agent_key,
    }


def policy_forager(state, params: UniversalPolicyParams, rng: random.Random, memory: PolicyMemory) -> Optional[dict]:
    agent_key = "forager"
    self_agent = state.agents[agent_key]
    other = state.agents["security"]

    if state.forager_stun_turns > 0:
        memory.t += 1
        set_policy_alpha(state, memory, agent_key, self_agent, 0.0, Vdig=float("nan"), Vmove=float("nan"), stunned=True)
        return None

    # 1. Value of staying and digging the current tile.
    current_key = coord_key(self_agent.x, self_agent.y)
    vdig = gold_value_at(state, memory, params, agent_key, self_agent.x, self_agent.y)
    exclude_gold_key = current_key if vdig > 0 else None

    # 2. Value of moving: lambda/social + visible gold + unexplored area.
    vmove, _, move_target = best_neighbor_move(state, memory, params, agent_key, self_agent, other, exclude_gold_key)
    alpha = vdig - vmove

    memory.vdig = vdig
    memory.vmove = vmove
    set_policy_alpha(
        state,
        memory,
        agent_key,
        self_agent,
        alpha,
        Vdig=vdig,
        Vmove=vmove,
        moveTargetX=move_target["x"] if move_target else None,
        moveTargetY=move_target["y"] if move_target else None,
        moveTargetValue=move_target["value"] if move_target else 0.0,
        moveTargetValueSource=move_target["valueSource"] if move_target else "none",
    )

    # 3. Choose between current action and movement.
    action = sample_choice(
        ["dig", "move"],
        [
            float(params.epsilon) * float(params.vdig_vmove_tradeoff) * vdig,
            float(params.epsilon) * (1 - float(params.vdig_vmove_tradeoff)) * vmove,
        ],
        rng,
        0.5,
    )
    if action == "dig" and is_active_revealed_gold(state, self_agent.x, self_agent.y):
        remember_policy_step(memory, self_agent)
        return {"kind": "action", "key": "d"}

    # 4. If moving, choose the neighbor direction with the same move utility.
    move_point = choose_move_target(state, memory, params, agent_key, self_agent, other, rng, exclude_gold_key)
    remember_policy_step(memory, self_agent)
    return step_toward(self_agent.x, self_agent.y, move_point["x"], move_point["y"]) if move_point else None


def security_scan_utility(state, memory: PolicyMemory, params: UniversalPolicyParams, self_agent, other) -> float:
    point = {"x": self_agent.x, "y": self_agent.y}
    return (
        social_distance_value(point, other, params)
        + float(params.reward_info) * gold_value_at(state, memory, params, "security", self_agent.x, self_agent.y)
    )


def policy_security(
    state,
    params: UniversalPolicyParams,
    rng: random.Random,
    memory: PolicyMemory,
    scan_cells_fn: Callable[[object, int, int], List[dict]],
) -> Optional[dict]:
    agent_key = "security"
    self_agent = state.agents[agent_key]
    other = state.agents["forager"]
    current_key = coord_key(self_agent.x, self_agent.y)

    if state.forager_stun_turns > 0:
        if self_agent.x == other.x and self_agent.y == other.y:
            set_policy_alpha(state, memory, agent_key, self_agent, 0.0, rescue=True)
            remember_policy_step(memory, self_agent)
            return {"kind": "action", "key": "r"}
        set_policy_alpha(state, memory, agent_key, self_agent, 0.0, rescue=True)
        remember_policy_step(memory, self_agent)
        return step_toward(self_agent.x, self_agent.y, other.x, other.y)

    # 1. Value of staying and scanning the current tile.
    scan_memory_depleted = is_security_scanned_gold(memory, self_agent.x, self_agent.y)
    scan_allowed_here = is_active_revealed_gold(state, self_agent.x, self_agent.y) and not scan_memory_depleted
    fixed_scan_value = gold_value_at(state, memory, params, agent_key, self_agent.x, self_agent.y)
    vscan = security_scan_utility(state, memory, params, self_agent, other) if scan_allowed_here else 0.0

    # 2. Value of moving: lambda/social + visible gold + unexplored area.
    # If security leaves an unscanned gold tile, softly discount that tile as a
    # future move target rather than forbidding a return.
    departed_gold_discount_key = current_key if scan_allowed_here else None
    departed_gold_discount = float(params.security_departed_gold_discount) if scan_allowed_here else 1.0
    vmove, _, move_target = best_neighbor_move(
        state,
        memory,
        params,
        agent_key,
        self_agent,
        other,
        discount_gold_key=departed_gold_discount_key,
        discount_gold_multiplier=departed_gold_discount,
    )
    alpha = vscan - vmove

    memory.vscan = vscan
    memory.vmove = vmove
    set_policy_alpha(
        state,
        memory,
        agent_key,
        self_agent,
        alpha,
        Vscan=vscan,
        Vmove=vmove,
        fixed_scan_value=fixed_scan_value,
        moveTargetX=move_target["x"] if move_target else None,
        moveTargetY=move_target["y"] if move_target else None,
        moveTargetValue=move_target["value"] if move_target else 0.0,
        moveTargetValueSource=move_target["valueSource"] if move_target else "none",
        moveGoldWeight=float(params.reward_info),
        moveDiscountedGoldKey=departed_gold_discount_key or "",
        moveDiscountedGoldMultiplier=departed_gold_discount,
        stunHotspot=current_key in memory.stun_hotspots,
        scanAllowedHere=scan_allowed_here,
        scanMemoryDepleted=scan_memory_depleted,
    )

    # 3. Choose between current scan and movement.
    if scan_allowed_here:
        action = sample_choice(
            ["scan", "move"],
            [float(params.epsilon) * vscan, float(params.epsilon) * vmove],
            rng,
            1.0,
        )
        if action == "scan" and current_key not in memory.chased:
            for point in scan_cells_fn(state, self_agent.x, self_agent.y):
                key = coord_key(point["x"], point["y"])
                memory.chased.add(key)
                memory.chase_areas.add(key)
            remember_policy_step(memory, self_agent)
            return {"kind": "action", "key": "s"}

    # 4. If moving, choose the neighbor direction with the same move utility.
    move_point = choose_move_target(
        state,
        memory,
        params,
        agent_key,
        self_agent,
        other,
        rng,
        discount_gold_key=departed_gold_discount_key,
        discount_gold_multiplier=departed_gold_discount,
    )
    if scan_allowed_here and move_point:
        remember_security_departed_gold_discount(memory, self_agent.x, self_agent.y, params.security_departed_gold_discount)
    remember_policy_step(memory, self_agent)
    return step_toward(self_agent.x, self_agent.y, move_point["x"], move_point["y"]) if move_point else None


def universal_policy(
    state,
    role: str,
    params: UniversalPolicyParams,
    rng: random.Random,
    scan_cells_fn: Optional[Callable[[object, int, int], List[dict]]] = None,
) -> Optional[dict]:
    agent_key = "security" if "security" in str(role).lower() else "forager"
    memory = state.policy_memory.setdefault(agent_key, PolicyMemory())
    self_agent = state.agents[agent_key]
    memory.visited.add(coord_key(self_agent.x, self_agent.y))
    scan_cells_fn = scan_cells_fn or default_scan_cells

    if agent_key == "forager":
        return policy_forager(state, params, rng, memory)
    return policy_security(state, params, rng, memory, scan_cells_fn)


__all__ = [
    "PolicyMemory",
    "UniversalPolicyParams",
    "coord_key",
    "is_security_scanned_gold",
    "man_dist",
    "neighbors",
    "policy_forager",
    "policy_security",
    "remember_gold_value",
    "social_distance_value",
    "softmax_choice",
    "step_toward",
    "universal_policy",
]
