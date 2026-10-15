#!/usr/bin/env python3
"""Real wall and roof colours for named landmarks (the city model gives them none, so they came out in the
generic or period palettes: a cream Rundetårn). Both eras.  python3 scripts/landmark-colours.py
"""
import json, re
BRICK, DARKBRICK, SAND, PLASTER, GREY = '#8e4a38', '#7a3d2f', '#cdbb94', '#e6dcc4', '#b9b4aa'
COPPER, SLATE, TILE = '#5f8f7a', '#4a4f52', '#8a3b2a'
L = [(r'rundetårn|trinitatis', BRICK, COPPER), (r'vor frelsers', BRICK, '#55585a'), (r'børsen', BRICK, COPPER),
     (r'rosenborg', BRICK, COPPER), (r'holmens kirke', BRICK, COPPER), (r'petri', BRICK, COPPER), (r'helligånds', BRICK, COPPER),
     (r'nikolaj', BRICK, COPPER), (r'christians kirke', PLASTER, COPPER), (r'garnisons', '#e2cfa0', COPPER),
     (r'christiansborg slotskirke', PLASTER, COPPER), (r'christiansborg', GREY, COPPER), (r'marmorkirken|frederiks kirke', '#ddd6c8', COPPER),
     (r'kastellet', BRICK, TILE), (r'amalienborg', '#d8cfbf', SLATE), (r'vor frue', '#ddd6c8', COPPER),
     # the model's own colours are wrong for these: red-brick City Hall, Glyptotek and Central Station, the black
     # Black Diamond, ochre Thorvaldsens Museum, cream Magasin, the grey-green glass Royal Hotel
     (r'^københavns rådhus$', '#9a4533', COPPER), (r'glyptotek', '#923f31', COPPER), (r'hovedbanegård', '#94493a', '#5b6064'),
     (r'sorte diamant', '#222426', '#2e3133'), (r'thorvaldsens museum', '#d8a854', '#9a4a32'), (r'magasin du nord', '#ede5d4', COPPER),
     (r'radisson.*royal', '#6e8080', '#4d5254'), (r'^hal [12]$', '#6f7f80', '#3d4245')]  # Torvehallerne's glass halls
hexrgb = lambda h: [round(int(h[i:i + 2], 16) / 255, 3) for i in (1, 3, 5)]
for city in ('copenhagen', 'copenhagen-1760'):
    p = f'public/cities/{city}/buildings3d-index.json'; idx = json.load(open(p)); n = 0
    for t in idx['tiles']:
        for q in t['parts']:
            name = q.get('name', '')
            for pat, wall, roof in L:
                if name and re.search(pat, name, re.I):
                    q['color'], q['roofColor'] = hexrgb(wall), hexrgb(roof); q.pop('modern', None); n += 1
                    if re.search(r'kirke|tårn|børsen', name, re.I): q['noFacade'] = True  # no generated house front on churches and towers
                    break
    json.dump(idx, open(p, 'w')); print(city, 'landmarks coloured', n)
