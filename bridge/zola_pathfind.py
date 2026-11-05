#!/usr/bin/env python3
"""zola_pathfind.py — THE AI BACKEND'S PATH RE-PLANNER (spec section 2).

The FC's costmap (its LOCAL 3 m frustum grid) reaches the backend over the
swarm mesh; THIS module re-plans the route around static and dynamic
obstacles with NetworkX (installed: 3.6.1) — the FC never runs graphs.

The grid: row-major, cell (0,0) = forward-left, +row = forward, +col = right
(the FC's costmap convention, mirrored in the firmware's math check).

Run standalone for a self-test:
    python bridge/zola_pathfind.py
"""
import heapq
import json
import sys

try:
    import networkx as nx
except ImportError:
    nx = None  # the pure-Python A* fallback below

# ------------------------------------------------------------------ grid
def build_graph(grid, n, start, goal, diag=True):
    """The occupancy grid → a NetworkX graph (or the fallback's adjacency).
    Occupied cells (value 1) are not nodes. Diagonal moves allowed (diag)
    but never THROUGH a blocked corner."""
    def open_cell(r, c):
        return 0 <= r < n and 0 <= c < n and grid[r * n + c] == 0

    if not open_cell(*start) or not open_cell(*goal):
        return None  # the start or goal is inside an obstacle — no plan exists

    if nx is not None:
        g = nx.Graph()
        for r in range(n):
            for c in range(n):
                if not open_cell(r, c):
                    continue
                g.add_node((r, c))
                steps = [(1, 0), (-1, 0), (0, 1), (0, -1)]
                if diag:
                    steps += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
                for dr, dc in steps:
                    r2, c2 = r + dr, c + dc
                    if not open_cell(r2, c2):
                        continue
                    if diag and dr != 0 and dc != 0:
                        # no corner cutting: both orthogonals must be open
                        if not open_cell(r + dr, c) or not open_cell(r, c + dc):
                            continue
                    cost = 1.414 if (dr and dc) else 1.0
                    g.add_edge((r, c), (r2, c2), weight=cost)
        return g
    return {"fallback": True}  # the fallback A* below needs no graph


def plan(grid, n, start, goal, diag=True):
    """The path as a list of (row, col), start → goal. None = no route.
    Prefers NetworkX (astar_path, octile heuristic); falls back to the
    built-in A* when networkx is missing."""
    if not (0 <= start[0] < n and 0 <= start[1] < n and 0 <= goal[0] < n and 0 <= goal[1] < n):
        return None
    if grid[start[0] * n + start[1]] or grid[goal[0] * n + goal[1]]:
        return None

    def heuristic(a, b):
        dr, dc = abs(a[0] - b[0]), abs(a[1] - b[1])
        return (max(dr, dc) + 0.414 * min(dr, dc))  # the octile distance

    if nx is not None:
        g = build_graph(grid, n, start, goal, diag)
        if g is None:
            return None
        try:
            return list(nx.astar_path(g, start, goal, heuristic=heuristic, weight="weight"))
        except nx.NetworkXNoPath:
            return None

    # ---- the fallback A* (identical guarantees, no dependency) ----
    def open_cell(r, c):
        return 0 <= r < n and 0 <= c < n and grid[r * n + c] == 0
    frontier = [(heuristic(start, goal), 0.0, start)]
    came = {start: None}
    cost = {start: 0.0}
    while frontier:
        _, g, cur = heapq.heappop(frontier)
        if cur == goal:
            path = [cur]
            while came[cur]:
                cur = came[cur]
                path.append(cur)
            return path[::-1]
        steps = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        if diag:
            steps += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
        for dr, dc in steps:
            nxt = (cur[0] + dr, cur[1] + dc)
            if not open_cell(*nxt):
                continue
            if diag and dr and dc and (not open_cell(cur[0] + dr, cur[1]) or not open_cell(cur[0], cur[1] + dc)):
                continue
            nc = cost[cur] + (1.414 if dr and dc else 1.0)
            if nxt not in cost or nc < cost[nxt]:
                cost[nxt] = nc
                came[nxt] = cur
                heapq.heappush(frontier, (nc + heuristic(nxt, goal), nc, nxt))
    return None


def self_test():
    """The self-test: an 11×11 grid (the FC's costmap size) with a wall the\n    route must go AROUND — and the no-corner-cutting rule verified."""
    n = 11
    grid = [0] * (n * n)
    # a vertical wall down column 5, rows 2..8 — rows 0,1 and 9,10 stay open
    for r in range(2, 9):
        grid[r * n + 5] = 1

    path = plan(grid, n, (5, 2), (5, 8))
    assert path, "no route found around the wall"
    assert path[0] == (5, 2) and path[-1] == (5, 8), "the path's endpoints are wrong"
    for (r, c) in path:
        assert grid[r * n + c] == 0, f"the path walked through the wall at {(r, c)}"
    # no corner cutting: every diagonal step's both orthogonals are open
    for a, b in zip(path, path[1:]):
        dr, dc = b[0] - a[0], b[1] - a[1]
        if abs(dr) == 1 and abs(dc) == 1:
            assert grid[(a[0] + dr) * n + a[1]] == 0 and grid[a[0] * n + a[1] + dc] == 0
    length = sum(1.414 if abs(b[0] - a[0]) and abs(b[1] - a[1]) else 1.0
                 for a, b in zip(path, path[1:]))
    straight = 6.0  # the unobstructed manhattan-ish minimum (6 cells)
    assert length > straight, "the path should be LONGER than the blocked straight line"
    print(f"pathfind: {len(path)} cells, length {length:.2f} (straight would be {straight}) — the wall was routed around")
    engine = "networkx" if nx else "fallback A*"
    print(f"pathfind self-test PASS (engine: {engine})")


if __name__ == "__main__":
    self_test()
