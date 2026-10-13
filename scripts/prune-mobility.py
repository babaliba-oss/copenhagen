#!/usr/bin/env python3
"""Keep only the main connected network in a city's mobility.json.

Small separate pieces of the road and footpath graphs (car parks, courtyards, slivers cut off by the data
edge) trap whoever spawns on them: cars and walkers then go round the same few metres forever.
Roads keep the largest strongly connected component (every edge can reach every other along one-way
streets); walks keep the largest weakly connected component. Usage: prune-mobility.py <city-id>
"""
import json, sys, sys as _s
_s.setrecursionlimit(10000)
cid = sys.argv[1]; path = f'public/cities/{cid}/mobility.json'
d = json.load(open(path))

def largest_scc(n, edges):
    adj = [[] for _ in range(n)]
    for e in edges: adj[e['from']].append(e['to'])
    index = [0]*n; low = [0]*n; on = [False]*n; idx = [None]*n; stack = []; best = []; counter = 1
    for s in range(n):
        if idx[s] is not None: continue
        work = [(s, 0)]
        while work:
            v, i = work.pop()
            if i == 0:
                idx[v] = low[v] = counter; counter += 1; stack.append(v); on[v] = True
            recurse = False
            while i < len(adj[v]):
                w = adj[v][i]; i += 1
                if idx[w] is None: work.append((v, i)); work.append((w, 0)); recurse = True; break
                elif on[w]: low[v] = min(low[v], idx[w])
            if recurse: continue
            if low[v] == idx[v]:
                comp = []
                while True:
                    w = stack.pop(); on[w] = False; comp.append(w)
                    if w == v: break
                if len(comp) > len(best): best = comp
            if work: u = work[-1][0]; low[u] = min(low[u], low[v])
    return set(best)

def largest_wcc(n, edges):
    par = list(range(n))
    def f(a):
        while par[a] != a: par[a] = par[par[a]]; a = par[a]
        return a
    for e in edges: par[f(e['from'])] = f(e['to'])
    from collections import Counter
    root = Counter(f(i) for i in range(n)).most_common(1)[0][0]
    return {i for i in range(n) if f(i) == root}

for key, fn in (('roads', largest_scc), ('walks', largest_wcc)):
    g = d[key]; n = len(g['nodes']); keep = fn(n, g['edges'])
    remap = {}; nodes = []
    for i in range(n):
        if i in keep: remap[i] = len(nodes); nodes.append(g['nodes'][i])
    edges = [dict(e, **{'from': remap[e['from']], 'to': remap[e['to']]}) for e in g['edges'] if e['from'] in keep and e['to'] in keep]
    print(f'{key}: {n} -> {len(nodes)} nodes, {len(g["edges"])} -> {len(edges)} edges')
    g['nodes'] = nodes; g['edges'] = edges
json.dump(d, open(path, 'w'), separators=(',', ':'))
