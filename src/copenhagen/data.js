// Copenhagen game layer data: delivery jobs, sagas (quests from Danish history and folklore) and the
// authored characters who give them. Positions are [lat, lon]; game.js projects them with the city's
// projection. Ported from Grand Theft Ladcykel (github.com/babaliba-oss/grand-theft-ladcykel).

export const JOBS = [
  { t: 'Smørrebrød for the Opera', d: 'The tenor wants rye bread with herring before curtain. Inderhavnsbroen is the fast way.', a: [55.67990, 12.58955, 'Nyhavn'], b: [55.68160, 12.60005, 'Operaen'], pay: 380 },
  { t: 'Wienerbrød for the Guard', d: 'A cinnamon snail for the Royal Guard. Hand it over, no eye contact.', a: [55.68105, 12.57720, 'Bakery on Købmagergade'], b: [55.68370, 12.59190, 'Amalienborg'], pay: 320 },
  { t: 'Tivoli tickets', d: 'Two tickets for a guy in Christiania. Leave the car outside.', a: [55.67470, 12.56710, 'Tivoli main gate'], b: [55.67360, 12.59900, 'Christiania'], pay: 560 },
  { t: 'Moving day', d: 'A friend is moving flats across the harbour. Take a bike, the bridges are faster.', a: [55.67400, 12.59200, 'Christianshavn'], b: [55.68540, 12.57780, 'Kongens Have'], pay: 480 },
  { t: 'Flag cake', d: 'Birthday cake with little Dannebrog flags. Do not tip it.', a: [55.68590, 12.57640, 'Rosenborg'], b: [55.67280, 12.59380, 'Vor Frelsers Kirke'], pay: 430 },
  { t: 'Rød pølse, express', d: 'A tourist at Nyhavn is hungry and a bit disappointed by the prices.', a: [55.67595, 12.56870, 'Rådhuspladsen'], b: [55.67985, 12.59000, 'Nyhavn'], pay: 360 },
  { t: 'Library returns', d: 'Three overdue books for the Black Diamond. The fine is already embarrassing.', a: [55.68136, 12.57580, 'Rundetårn'], b: [55.67340, 12.58210, 'Den Sorte Diamant'], pay: 340 },
  { t: 'Ice lollies for the lifeguards', d: 'A cool box for the lifeguards at Havnebadet. They melt, so take Langebro.', a: [55.67340, 12.58210, 'Den Sorte Diamant'], b: [55.66510, 12.57360, 'Havnebadet Islands Brygge'], pay: 410 },
  { t: 'Flowers for Strøget', d: 'A bucket of tulips for a shop on Amagertorv. Mind the pedestrians.', a: [55.67910, 12.56750, 'Ørstedsparken'], b: [55.67870, 12.57920, 'Amagertorv'], pay: 300 },
];

// Copenhagen 1760 (the copenhagen-1760 city): errands inside the walls, on foot or by cart.
export const JOBS_1760 = [
  { t: 'A letter for the Exchange', d: 'A merchant in Nyhavn needs this sealed letter at Børsen before the bell. Ships wait for no one.', a: [55.67990, 12.58955, 'Nyhavn'], b: [55.67568, 12.58380, 'Børsen'], pay: 192 },
  { t: 'Herring for the Palace kitchens', d: 'Two baskets from the fishwives on Gammel Strand. The cook at Christiansborg is not a patient man.', a: [55.67745, 12.57860, 'Gammel Strand'], b: [55.67620, 12.58010, 'Christiansborg'], pay: 144 },
  { t: 'Ink for the University', d: 'A crate of ink and quills from Købmagergade to the professors by Vor Frue.', a: [55.68105, 12.57720, 'Købmagergade'], b: [55.67935, 12.57390, 'University'], pay: 144 },
  { t: 'Beer across the harbour', d: 'A small keg from Christianshavn for the inn on Kongens Nytorv. Over Knippelsbro, mind the toll man.', a: [55.67330, 12.59180, 'Christianshavn'], b: [55.67980, 12.58530, 'Kongens Nytorv'], pay: 192 },
  { t: 'Plans for Amalienborg', d: 'Rolled drawings from the architect Eigtved\'s office for the new palaces. Keep them dry.', a: [55.67750, 12.58700, 'Holmen'], b: [55.68400, 12.59300, 'Amalienborg'], pay: 288 },
  { t: 'Bread for the Watch', d: 'Rye loaves for the guard at Nørreport before the gate closes.', a: [55.67810, 12.57350, 'Gammeltorv'], b: [55.68320, 12.57160, 'Nørreport'], pay: 96 },
  { t: 'Tobacco to the Kastel', d: 'A twist of tobacco for an officer at Kastellet. He says the last boy was slow.', a: [55.68020, 12.58020, 'Østergade'], b: [55.69130, 12.59350, 'Kastellet'], pay: 144 },
];

export const SAGAS = [
  { id: 'hca', era: 'm', title: 'Andersen\'s Three Homes', giver: 'karen', pay: 600,
    intro: 'Hans Christian Andersen lived on Nyhavn three times. Ride to all three houses in order. Then take this paper swan to the girl at Langelinie. He never met her, but she\'s his.',
    go: 'Nyhavn 20 first. That\'s where the fairy tales started.',
    steps: [
      { at: [55.67945, 12.59080], name: 'Nyhavn 20', card: ['Nyhavn 20 · 1834–38', 'Andersen is 29, broke, and renting a room here. He writes his first fairy tales at this address: The Tinderbox, The Princess and the Pea, Little Ida\'s Flowers. They come out in 1835 and the critics are not impressed.'] },
      { at: [55.68002, 12.59150], name: 'Nyhavn 67', card: ['Nyhavn 67 · 1848–65', 'Now he\'s famous. He lives here for seventeen years, two rooms looking out over the masts. Kings invite him to dinner. He still worries every review will be the one that ruins him.'] },
      { at: [55.67942, 12.59045], name: 'Nyhavn 18', card: ['Nyhavn 18 · 1871–75', 'His last address on the canal. By now the tales are read in dozens of languages. He dies in August 1875, at a friend\'s villa called Rolighed. The whole city turns out for the funeral.'] },
      { at: [55.69292, 12.59920], name: 'Den Lille Havfrue', card: ['Den Lille Havfrue · 1913', 'Carl Jacobsen of Carlsberg saw a ballet of The Little Mermaid and paid for a statue. Edvard Eriksen made her. The ballerina Ellen Price posed for the head, his wife Eline for the rest. You leave the paper swan at her feet. Ugly ducklings, it turns out, do fine.'] }] },
  { id: 'gefion', era: 'm', title: 'Gefion\'s Plough', giver: 'aksel', pay: 500, limit: 240,
    intro: 'Think you can plough like Gefion? Ride the furrow: Kastellet, Marmorkirken, Amalienborg and back to me. Four minutes. Her oxen had a day and a night. You have a bike.',
    go: 'Go! Kastellet first. Pull, oxen!',
    steps: [
      { at: [55.68880, 12.59330], name: 'Kastellet gate', toast: ['First furrow', 'The oxen strain. Marmorkirken next.'] },
      { at: [55.68502, 12.58940], name: 'Marmorkirken', toast: ['Second furrow', 'The land creaks. Amalienborg.'] },
      { at: [55.68405, 12.59300], name: 'Amalienborg', toast: ['Third furrow', 'Back to the fountain. Now!'] },
      { at: [55.68637, 12.59775], name: 'Gefionspringvandet', card: ['Gefionspringvandet · 1908', 'Snorri wrote the story down around 1220. King Gylfi of Sweden promised Gefion as much land as four oxen could plough in a day and a night. She turned her four sons into oxen and ploughed so deep the land came loose. She dragged it into the sea and named it Zealand. In Snorri\'s telling, the hole filled with water and became lake Mälaren. Anders Bundgaard\'s fountain was a gift from the Carlsberg Foundation.'] }] },
  { id: 'eye', era: 'h', title: 'The King\'s Eye', giver: 'ghost', pay: 500,
    intro: 'July 1644. Colberger Heide. A Swedish shot hits my ship and the splinters take my right eye. I got up and kept giving orders. Ride to what I built and I\'ll tell you the rest. Then come back to my tower.',
    go: 'My exchange first. The Børsen. You can\'t miss the dragons.',
    steps: [
      { at: [55.67568, 12.58380], name: 'Børsen', card: ['Børsen · 1619–40', 'My exchange. Merchants under one long roof by the water, and on top a spire of four dragons with their tails twisted together. Nobody else in Europe had one. Nobody else in Europe had me.'] },
      { at: [55.67490, 12.57860], name: 'Tøjhuset', card: ['Tøjhuset · 1604', 'My arsenal. Ships row straight in through the harbour gate to load cannon. In 1644 those cannon go to sea. A poet called Ewald will turn that day into a song in 1779: "Kong Christian stod ved højen mast." It becomes the royal anthem. I\'m told it is very good.'] },
      { at: [55.68590, 12.57640], name: 'Rosenborg', card: ['Rosenborg · 1606', 'My summer house, out among the gardens. The story goes that the splinters from my eye were set into earrings for Vibeke Kruse. I died here in February 1648. Comfortable house. Would die there again.'] },
      { at: [55.68136, 12.57580], name: 'Rundetårn', card: ['Rundetårn · 1642', 'Look up at the rebus on the front. Gold letters and pictures: God, guide learning and justice into the heart of the crowned King Christian IV. I had it put there so nobody would forget who built the thing. It worked.'] }] },
  { id: 'fire', era: 'h', title: 'Fire Watch', giver: 'watchman', pay: 400, limit: 210, night: true,
    intro: 'Five lanterns are out in my district, and a dark street is a burning street waiting to happen. Light them all, any order, before the next hour is called. Go!',
    go: 'Gammeltorv, Vor Frue, Højbro, Nikolaj, Kongens Nytorv. Run!',
    steps: [
      { at: [55.67810, 12.57350], name: 'Gammeltorv', any: 1, lantern: 1, toast: ['Lantern lit', 'Gammeltorv'] },
      { at: [55.67935, 12.57390], name: 'Vor Frue', any: 1, lantern: 1, toast: ['Lantern lit', 'Vor Frue. Rebuilt after 1728.'] },
      { at: [55.67830, 12.57950], name: 'Højbro Plads', any: 1, lantern: 1, toast: ['Lantern lit', 'Højbro Plads'] },
      { at: [55.67885, 12.58210], name: 'Nikolaj', any: 1, lantern: 1, toast: ['Lantern lit', 'Sankt Nikolaj'] },
      { at: [55.67995, 12.58560], name: 'Kongens Nytorv', any: 1, lantern: 1, toast: ['Lantern lit', 'Kongens Nytorv'] },
      { at: [55.67955, 12.58800], name: 'Back to the Watchman', card: ['Copenhagen burns · 1728 and 1795', 'The fire of October 1728 burned for days and took a large part of the medieval city, the university and Vor Frue with it. The Watchman is right: it happens again in 1795, and this time Nikolaj burns. Afterwards a rule: corner houses get their corners cut off, so the fire engines can turn. Ride around Copenhagen in 2026 and look at the corners. They\'re still cut.'] }] },
  { id: 'nisse', era: 'b', title: 'Porridge for the Nisser', giver: 'nisse', pay: 400,
    intro: 'Christmas is close enough to worry about. The house-nisser of this city expect their risengrød, with a knob of butter on top. Fetch a pot from the bakery on Købmagergade and feed five of my cousins. They hide well. Look for red hats.',
    go: 'Bakery first. And don\'t forget the butter.',
    steps: [
      { at: [55.68105, 12.57720], name: 'Bakery, Købmagergade', card: ['Risengrød', 'Rice cooked slowly in milk, with a knob of butter melting in the middle. In the old story a farmhand hid the nisse\'s butter at the bottom of the bowl. The nisse saw none, flew into a rage and killed the best cow in the barn. Then he found the butter. Always put the butter on top.'] },
      { at: [55.67950, 12.57700], name: 'Gråbrødretorv', any: 1, nisse: 1, toast: ['Nisse fed', 'Gråbrødretorv. He says tak.'] },
      { at: [55.68830, 12.58790], name: 'Nyboder', any: 1, nisse: 1, toast: ['Nisse fed', 'Nyboder. The sailors\' nisse.'] },
      { at: [55.67380, 12.59050], name: 'Christianshavns Kanal', any: 1, nisse: 1, toast: ['Nisse fed', 'Christianshavn. He wanted more butter.'] },
      { at: [55.67650, 12.58280], name: 'Holmens Kirke', any: 1, nisse: 1, toast: ['Nisse fed', 'Holmens Kirke. A church nisse. Very formal.'] },
      { at: [55.69130, 12.59350], name: 'Kastellet', any: 1, nisse: 1, toast: ['Nisse fed', 'Kastellet. He salutes.'] }] },
  { id: 'holger', era: 'b', title: 'Holger Danske\'s Map', giver: 'ole', pay: 700,
    intro: 'Found this in a herring barrel. A map torn in three, no street names on it. Old sailors say it leads to Holger Danske, the knight who sleeps until Denmark needs him. No beams, no GPS. Just the map. Press K to look at it.',
    go: 'First piece. North is up. Find the X. Press K any time to look again.',
    steps: [
      { at: [55.67560, 12.57790], name: 'The first X', clue: 1, r: 16, card: ['Slotsholmen · 1167', 'Bishop Absalon built a castle here in 1167, on a little island next to a fishing village called Havn. That is where Copenhagen starts. The ruins are still down there, under Christiansborg. Wedged between two stones: the second piece of the map.'] },
      { at: [55.67300, 12.59360], name: 'The second X', clue: 1, r: 16, card: ['Christianshavn · 1617', 'Christian IV had a new town built here on the shallows, canals and all, the Dutch way. Folded into the map is a note: Holger Danske rode with Charlemagne in the old French songs, and the Danes kept him anyway. Andersen wrote a tale about him in 1845. The third piece points north.'] },
      { at: [55.69340, 12.59440], name: 'The last X', clue: 1, r: 18, card: ['Norgesporten, Kastellet', 'The north gate. Look north: 45 km up the coast is Kronborg, and in its cellars Holger Danske sleeps, his beard grown into the stone table. He wakes when Denmark is in danger. In the Second World War a resistance group took his name. The treasure? The map was the treasure. Also, 700.'] }] },
];

// Characters who stand at fixed places and give sagas. `script` selects their dialogue in characters.js.
export const CHARACTERS = [
  { id: 'ghost', era: 'h', name: 'Christian IV', label: 'A king who died in 1648, Rundetårn', at: [55.68136, 12.57600], look: { coat: '#1c1c22' } },
  { id: 'watchman', era: 'h', name: 'Vægteren', label: 'Night watchman, Gammeltorv', at: [55.67800, 12.57300], look: { coat: '#3a3226' } },
  { id: 'maren', era: 'h', name: 'Maren', label: 'Fishwife, Gammel Strand', at: [55.67760, 12.57900], look: { coat: '#6b2b2b' } },
  { id: 'thurah', era: 'h', name: 'Mester Thurah', label: 'Royal architect, Frederiksstaden', at: [55.68380, 12.59140], look: { coat: '#2d3d5a' } },
  { id: 'karen', name: 'Karen', label: 'Walking tour guide, Nyhavn', at: [55.67972, 12.58930], look: { coat: '#d8402e' } },
  { id: 'aksel', name: 'Aksel', label: 'Regular at the Gefion Fountain', at: [55.68622, 12.59745], look: { coat: '#5a6b4a' } },
  { id: 'nisse', name: 'Nissefar', era: 'b', label: 'House-nisse, Kongens Have', at: [55.68525, 12.57930], look: { coat: '#7a2a20', height: 1.1 } },
  { id: 'ole', name: 'Ole', era: 'b', label: 'Retired fisherman, Gammel Strand', at: [55.67745, 12.57860], look: { coat: '#2b3a55' } },
  { id: 'bent', name: 'Bent', label: 'Pølsevogn, Rådhuspladsen', at: [55.67610, 12.56880], look: { coat: '#f2f2ee' } },
  { id: 'astrid', name: 'Astrid', label: 'Telescope keeper, Rundetårn', at: [55.68152, 12.57560], look: { coat: '#4a3b6b' } },
  { id: 'hca', name: 'H.C. Andersen', label: 'Writer of fairy tales, Nyhavn 20 (an easter egg)', at: [55.67970, 12.59000], local: [892.8, 38.5], look: { coat: '#1d1f2b', height: 1.85 } },
  { id: 'mette', name: 'Mette', label: 'Lives in Christiania', at: [55.67380, 12.59870], look: { coat: '#3c6b3a' } },
];
