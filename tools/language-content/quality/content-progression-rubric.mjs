// Editorial migration rubric, not runtime policy. The resulting numbers live
// on the authored records and can be revised without running this classifier.
// English is the shared audit language; learner translations are never treated
// as English. Utility and task demand are independent of the retained badge.
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[’]/gu, "'").trim();
const words = value => normalize(value).replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim().split(/\s+/u);
const group = text => new Set(text.split('|'));
const essential = group('be|have|do|can|need|want|go|come|eat|drink|sleep|wake|speak|say|ask|answer|understand|help|see|hear|listen|read|write|live|buy|pay|stop|wait|give|take|find|open|close|learn|know|yes|no|please|thanks|thank|hello|goodbye|welcome|sorry|excuse|water|food|toilet|bathroom|restroom|home|house|name|mother|father|parent|child|family|friend|doctor|hospital|hurt|pain|lost|hungry|thirsty|danger|emergency|safe|safety|money|price|ticket|bus|train|station|school|teacher|student|work|today|tomorrow|yesterday|now|here|there|where|when|who|what|how|why|which|this|that|these|those|i|you|he|she|we|they|me|us|it|not|and|or');
const practical = group('get|make|use|tell|look|watch|meet|call|talk|reply|explain|repeat|remember|forget|think|feel|like|love|care|wash|clean|cook|put|sit|stand|walk|run|drive|ride|travel|arrive|leave|return|start|finish|choose|try|play|share|check|show|send|receive|bring|carry|hold|wear|change|turn|move|keep|let|leave|stay|rest|wake|dress|shop|order|ask|cost|count|plan|practice|study|spell|work|stop|reach|touch|fall|catch|throw|look|search|smile|laugh|cry|thank|greet|invite|visit|lend|borrow|repair|read|write|print|save|book|phone|door|window|key|bag|bed|room|table|chair|kitchen|cup|glass|bottle|milk|bread|fruit|rice|tea|coffee|apple|banana|vegetable|egg|cheese|meat|fish|dog|cat|car|bike|bicycle|road|street|map|shop|store|market|coat|shirt|shoe|sock|hat|hand|head|eye|ear|foot|body|weather|rain|snow|sun|hot|cold|warm|big|small|good|bad|new|old|long|short|fast|slow|happy|sad|tired|red|blue|green|yellow|white|black|one|two|three|four|five|six|seven|eight|nine|ten');
const specialized = group('calculate|hypothesize|infer|deduce|justify|synthesize|classify|evaluate|negotiate|authorize|legislate|ratify|subsidize|audit|allocate|assess|invest|insure|invoice|reimburse|file|register|encrypt|configure|compile|debug|format|download|upload|authenticate|synchronize|digitize|evaporate|condense|crystallize|photosynthesize|germinate|pollinate|ferment|incubate|dissect|dissolve|magnetize|orbit|refract|conductivity|voltage|circuit|molecule|atom|mineral|sediment|fossil|enzyme|bacteria|ecosystem|hypothesis|parliament|legislation|constitution|petition|contract|mortgage|pension|interest|investment|insurance|tax|visa|permit|application|invoice|receipt|algorithm|password|browser|software|database|spreadsheet|document|identity|citizenship|administration|municipality|institution|scientific|laboratory|experiment|microscope|telescope|thermometer|compass|equation|fraction|geometry|percentage|probability|evidence|interpretation|conclusion|consequence');
const rare = group('distill|electrolyze|centrifuge|polymerize|sublimate|refinance|arbitrate|expropriate|amortize|electrolysis|photosynthesis|chromatography|centrifuge|amortization|expropriation|jurisdiction|legislature|referendum|biodiversity');
const abstract = group('believe|suppose|assume|imagine|pretend|consider|decide|prefer|expect|hope|wish|seem|mean|matter|depend|belong|agree|disagree|promise|suggest|recommend|compare|contrast|prove|solve|reason|reflect|concentrate|persevere|anticipate|investigate|distinguish|estimate|interpret|justify|persuade|reassure|appreciate|admire|negotiate|cooperate|responsibility|opportunity|possibility|confidence|independence|patience|respect|justice|freedom|belief|opinion|purpose|quality|reason|result|effect|cause|advice|choice|decision|change|experience');
const practicalTopic = /(daily|everyday|home|food|kitchen|shopping|travel|movement|communication|language|health|body|family|people|school|learning|weather|time|directions|basics)/u;
const specializedTopic = /(science|reasoning|finance|admin|rights|rules|digital|evidence|resources)/u;
const clamp = value => Math.max(1, Math.min(100, Math.round(value)));
const irregularBokmal = group('være|ha|gjøre|gå|komme|se|si|drikke|sove|skrive|hete|synge|løpe|finne|ta|gi|sitte|stå|ligge|hjelpe|le|fly|bære|velge|spørre|fortelle|forstå|vite|fortsette|holde|legge|sette|henge|falle|selge|foreslå|beskrive|avgjøre|planlegge|delta|bidra|tilgi|tillate|unngå|tilby|motta|beholde|inneholde|oversette');
const spanishStemChanges = group('jugar|dormir|construir|regar|medir|proponer|contribuir|distinguir|convencer|elegir');
const genderExceptions = group('problema|mapa|mano|foto|día|idioma|sofá|planeta|sistema|poema|tema|clima|agua');
const inflected = { people: 'person', children: 'child', men: 'man', women: 'woman', mice: 'mouse', geese: 'goose',
  teeth: 'tooth', feet: 'foot', wolves: 'wolf', leaves: 'leaf', knives: 'knife', criteria: 'criterion', analyses: 'analysis',
  is: 'be', am: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be', has: 'have', had: 'have',
  went: 'go', gone: 'go', going: 'go', came: 'come', coming: 'come', took: 'take', taken: 'take', taking: 'take',
  gave: 'give', given: 'give', giving: 'give', made: 'make', making: 'make', said: 'say', saw: 'see', seen: 'see',
  found: 'find', bought: 'buy', brought: 'bring', ate: 'eat', eaten: 'eat', drank: 'drink', slept: 'sleep',
  wrote: 'write', written: 'write', writing: 'write', knew: 'know', known: 'know', ran: 'run', running: 'run',
  reading: 'read', working: 'work', playing: 'play', learning: 'learn', cooking: 'cook', eating: 'eat', drinking: 'drink' };
const inflectionBase = token => inflected[token] || (token.endsWith('ies') ? token.slice(0, -3) + 'y'
  : /(?:xes|ches|shes|sses|buses)$/u.test(token) ? token.slice(0, -2)
  : token.endsWith('s') && !/(?:ss|is|us)$/u.test(token) ? token.slice(0, -1) : token);

export function englishAuditText(item) {
  return item.englishAuditText || item.englishText || item.english || item.en || item.meaning || item.translation || item.source || item.learnerBaseText || '';
}
function lexemeHead(text) {
  return normalize(text).replace(/^to /u, '').replace(/\([^)]*\)/gu, '').split(/;|\s+or\s+|\//u)[0].trim();
}
const functional = group('i|you|he|she|we|they|me|us|it|and|or|not|this|that|these|those|there|who|what|when|where|how|why|which|be|have|do|can');
const firstContact = group("hello|hi|goodbye|bye|thank you|thanks|thanks a lot|please|sorry|i am sorry|i'm sorry|excuse me|you are welcome|you're welcome|yes|no|yes please|no thank you|no thanks|good morning|good afternoon|good evening|good night|yes that is right|no that is not right|how are you|i'm fine|i am fine|see you|see you later|see you tomorrow|see you soon|here you are|just a moment");
const plainMeaning = value => normalize(value).replace(/[,!.?¡¿]+/gu, ' ').replace(/\s+/gu, ' ').trim();
const repairFormula = /^(?:again please|once more please|please say it again|say it again please|(?:can|could) you (?:say it again|repeat(?: that)?|speak (?:more )?slowly)|please speak (?:more )?slowly|speak (?:more )?slowly please|(?:i do not|i don't) understand)$/u;
const needFormulaPattern = /^(?:i (?:am|'m) (?:hungry|thirsty)|i (?:do not|don't) (?:know|understand)|i need (?:help|water)|(?:can|could) you help(?: me)?|(?:where is|where's) the (?:toilet|bathroom|restroom)|(?:what is|what's) your name|my name is .+)$/u;
const everydayDomains = [
  [/\b(?:water|hungry|thirsty|food|toilet|bathroom|restroom|help|understand)\b/u, 88, 'basic needs and comprehension'],
  [/\b(?:doctor|hospital|medicine|pain|hurt|safety|safe|emergency)\b/u, 85, 'health and safety'],
  [/\b(?:pay|buy|cost|price|ticket|bus|train|station|direction|address|street|shop|money)\b/u, 81, 'essential services and navigation'],
  [/\b(?:family|parent|child|mother|father|friend|school|teacher|work|home|house)\b/u, 77, 'home and social participation'],
  [/\b(?:phone|call|meet|visit|message|appointment|borrow|lend|repair|order|repeat|explain)\b/u, 79, 'practical coordination'],
  [/\b(?:cook|clean|wash|wear|eat|drink|sleep|bread|milk|rice|fruit|clothes|weather|time)\b/u, 75, 'daily routines'],
  [/\b(?:book|read|write|learn|study|practice|question|answer|number|count)\b/u, 73, 'learning and communication'],
  [/\b(?:play|game|sport|music|dance|draw|paint|garden|beach|holiday|hobby)\b/u, 62, 'leisure and participation'],
];
const irregularNouns = /\b(?:feet|teeth|children|people|mice|men|women|geese)\b/u;
const semanticFamilies = [
  [90, 22, 'essential directional or state expression', group('toward|into|onto|on|after|missing|cold|tired|correct')],
  [82, 26, 'common practical actions', group('reserve|sell|provide|replace|connect|adjust|complain|report|lose|find|protect|guide|pass|lift|push|pull|fasten|unfasten|interrupt|arrange|earn|raise|attempt|remind')],
  [71, 28, 'everyday movement and interaction', group('fly|kick|crawl|whisper|shout|nod|hug|embrace|cheer|win|roll|row|stroke|lick|sniff|bite|sigh|tremble|appear|disappear|shine|wet|dry|happen|become')],
  [57, 36, 'situational finance and logistics', group('crown|transfer|withdrawal|deposit|tip|connection|inspection|parking|petrol|diesel|roaming|limit|arrangement|resume|track')],
  [49, 39, 'craft and mechanical detail', group('knit|crochet|whittle|shape|dye|stamp|staple|nail|crush|shatter|embroider|improvise|twist|snap|split|pluck|sprinkle|crumble|slam|squirt|gush|shrink|flap|growl|roar|meow|hum|whistle')],
  [91, 21, 'reusable grammatical relationship', group('whose|where|how|what|which|must|should|may|able|called|know|but|because|if|whether|to|from|with|without|in|at|for|about|during|instead|against|toward|into|according|outside|inside|together|something|nothing|someone|nobody|everything')],
  [88, 24, 'personal health and care', group('clinic|police|nurse|dentist|pharmacy|fever|bandage|dangerous|protect|prevent|avoid|survive|heart|stomach|mouth|nose|leg|arm|shoulder|elbow|knee|neck|throat|finger|toe|hair')],
  [84, 22, 'numbers and quantities', group('zero|twenty|thirty|hundred|thousand|million|much|many|enough|empty|full|half|whole|each|every')],
  [83, 25, 'public services and getting around', group('cash|card|atm|payment|coin|banknote|wallet|cheap|expensive|discount|bill|tram|metro|taxi|airport|platform|timetable|carriage|seat|departure|arrival|delay|driver|luggage|suitcase|terminal|gate|traffic|navigation|entrance|exit|passport|ferry|harbour|hotel|hostel|restaurant|cafe|café|reserve|reservation|cancel|postpone')],
  [80, 23, 'household and everyday objects', group('apartment|bedroom|hallway|floor|roof|wall|staircase|cupboard|shelf|carpet|cushion|mirror|sofa|pillow|blanket|lamp|clock|box|lock|curtain|duvet|towel|soap|shampoo|toothbrush|toothpaste|comb|refrigerator|freezer|cooker|oven|dishwasher|vacuum|broom|bucket|sponge|pants|skirt|jacket|sneaker|sweater|hoodie|jean|glove|mitten|scarf|belt|sandal|boot|overcoat|umbrella|raincoat|pyjama|clothes|clothing|sunscreen')],
  [78, 23, 'common meals and ingredients', group('orange|pear|strawberry|grape|lemon|tomato|potato|carrot|cookie|sandwich|fork|spoon|plate|bowl|napkin|cucumber|soup|pasta|butter|lunch|meal|pot|plum|peach|blueberry|raspberry|nut|raisin|onion|garlic|broccoli|cauliflower|salad|lettuce|pea|bean|omelette|waffle|pancake|bun|crispbread|porridge|jam|cream|cod|salmon|shrimp|peel|stir|pour')],
  [79, 25, 'relationships and participation', group('neighbour|neighbor|sister|brother|daughter|son|grandmother|grandfather|aunt|uncle|person|people|boy|girl|man|woman|children|apologize|translate|clarify|confirm|notify|remind|request|allow|permission|attend|accompany|encourage|forgive|comfort|support|include|participate|collaborate|cooperate')],
  [75, 26, 'classroom and workplace', group('pupil|student|teacher|class|course|lesson|meeting|office|project|task|homework|wage|employment|job|training|boss|client|team|board|notebook|pencil|pen|paper|eraser|exam|test|grade|schedule|lecture|textbook|diploma|interview|presentation|note|ruler|colleague|employee|company|profession|leader|library|language|word|sentence|sound|vowel|consonant|grammar|dictionary|prepare|complete|deliver|organize|improve')],
  [72, 27, 'personal technology', group('email|internet|wifi|app|account|photo|charger|battery|screen|link|signal|contact|setting|login|update|storage|printer|headphone|computer|keyboard|camera|tablet|telephone|button|cord')],
  [70, 34, 'everyday descriptions and feelings', group('near|far|closed|free|available|occupied|same|different|beautiful|dirty|heavy|difficult|light|easy|important|possible|right|true|left|comfortable|noisy|quiet|better|worse|complicated|feeling|glad|happy|happiness|sadness|fear|afraid|nervous|satisfied|angry|joy|calm|stress|fun|worry|relax|enjoy|surprise|trust|friendship|miss|love|hope|dream|thought|memory')],
  [65, 26, 'familiar animals and surroundings', group('city|town|village|square|place|park|forest|river|bridge|mountain|lake|sea|tree|flower|cloud|moon|star|sky|wind|ice|storm|rainbow|sun|beach|bird|horse|cow|pig|sheep|goat|hen|chicken|duck|rabbit|mouse|ant|spider|frog|worm|leaf|stone|pet|plant|grow|smell|taste|feed')],
  [63, 28, 'leisure and social activity', group('film|movie|trip|invitation|celebration|party|celebrate|congratulate|hug|wave|clap|jump|swim|sing|skate|pedal|climb|camp|hike|walk|football|handball|tennis|ski|sledge|playground|ball|toy|doll|balloon|gift|kite|swing|slide|song|story|poem|chapter|concert|museum|cinema|theater|theatre|drawing|painting|colour|color|picture|outing')],
  [58, 31, 'making and exploring', group('fold|unfold|decorate|glue|weave|knead|collect|measure|weigh|guess|explore|notice|wonder|observe|invent|combine|adapt|build|cut|sew|tie|untie|wrap|unwrap|trace|model|mold|sculpt|illustrate|photograph|record|tune|rehearse|act|imitate|design|compose|hammer|saw|drill|rope|thread|yarn|fabric|needle|scissors|puppet|costume|stage|drum|flute|guitar|piano|violin|trumpet|mask|sculpture|paintbrush|canvas')],
  [48, 37, 'less frequent animals and natural detail', group('hedgehog|squirrel|owl|turtle|snail|whale|dolphin|penguin|lion|tiger|elephant|giraffe|zebra|monkey|rooster|chick|donkey|fox|wolf|deer|reindeer|moose|beaver|otter|raccoon|badger|bat|seal|walrus|kangaroo|koala|panda|camel|hippopotamus|rhinoceros|crocodile|lizard|snake|octopus|squid|crab|jellyfish|shark|seahorse|starfish|tarantula|ladybug|beetle|grasshopper|cricket|dragonfly|caterpillar|cocoon|eagle|parrot|swan|goose|turkey|peacock|swallow|robin|sparrow|flamingo|seagull|pelican|hummingbird|stork|nest|feather|acorn|thorn|petal|fern|moss|mushroom|oak|birch|willow|daisy|tulip|poppy|shrub|pine|spruce|bark|purr|neigh|cluck|chirp|buzz|croak|howl|moo|graze|peck|gnaw|hatch')],
  [46, 38, 'landscape and outdoor detail', group('pond|meadow|waterfall|island|shell|pebble|coast|peninsula|bog|fjord|cave|cliff|valley|hill|trail|stream|volcano|desert|oasis|glacier|iceberg|puddle|snowflake|drop|breeze|lightning|thunder|dune|stem|root|branch|sprout|seed|trunk|soil|rake|dig|sow|weed|prune|fertilize|harvest|ripen|melt|freeze|drip|bloom|wilt|float|splash|bounce')],
  [52, 43, 'abstract social and creative reasoning', group('kindness|courage|curiosity|imagination|cooperation|agreement|difference|similarity|explanation|solution|discovery|invention|observation|prediction|achievement|challenge|effort|solidarity|empathy|generosity|honesty|gratitude|initiative|autonomy|perseverance|value|represent|symbolize|prioritize|empathize|tolerate|inspire|console|involve|integrate|commit|benefit|motivate|influence|engage|reconcile|donate|acknowledge|perceive|reflect|regret|dread|envy|hate|disappoint|overwhelm|impress|convince|persuade')],
  [34, 48, 'specialist science and quantitative reasoning', group('analysis|analyze|criterion|criteria|phenomenon|sequence|pattern|symmetry|proportion|denominator|numerator|variable|measurement|unit|scale|distance|speed|acceleration|gravity|energy|electricity|magnetism|friction|density|temperature|humidity|evaporation|condensation|erosion|adaptation|migration|hibernation|metamorphosis|cycle|satellite|asteroid|meteorite|galaxy|nebula|eclipse|equinox|solstice|atmosphere|universe|cell|force|theory|method|researcher|hypothesis|pollination|constellation|habitat|species|predict|transform|demonstrate|approximate|evolve|regenerate|hibernate|erode|migrate')],
  [44, 41, 'specialist practical and organizational processes', group('coordinate|implement|reduce|increase|accumulate|remodel|convert|convey|promote|consolidate|restore|preserve|contribute|summarize|mediate|refine|distribute|balance|alternate|exchange|reconstruct|assemble|harmonize|resonate|reforest|compost|renovate|cast|grind|pollute|eradicate|approve|reject|publish|edit|produce|develop|lead|hire|protest|boycott|law|rule|duty|resource|environment|climate|pollution|waste|plastic|metal|steel|timber|brick|county|border')],
];
function semanticFamily(tokens, phrase) {
  return semanticFamilies.find(([score, , , vocabulary]) => (score !== 91 || !phrase) && tokens.some(token => vocabulary.has(token)));
}

// Scores are ordinal editorial anchors, not measured percentages. Features
// refine an anchor by a few points; old five-point grades never enter scoring.
function lexicalUsefulness(text, category, phrase, courseId) {
  const normalized = normalize(text).replace(/[!.?¡¿]+$/gu, ''), plain = plainMeaning(text);
  const head = lexemeHead(text), tokens = words(head).map(inflectionBase);
  if (firstContact.has(plain)) return [94, 'first-contact formula'];
  if (repairFormula.test(plain)) return [98, 'comprehension repair'];
  if (/^(?:what should i do|where do i start)$/u.test(plain)) return [95, 'requesting immediate guidance'];
  if (/^(?:i am|i'm) (?:cold|tired)$/u.test(plain)) return [93, 'communicating an immediate physical state'];
  if (/^(?:stop please|please stop)$/u.test(plain)) return [99, 'immediate safety response'];
  if (/^(?:thanks?\b|thank you\b|goodbye\b|see you\b|sorry\b|i am sorry\b|i'm sorry\b|you are welcome\b)/u.test(plain)) return [90, 'politeness and social repair in context'];
  if (plain === 'please come in') return [89, 'short practical invitation'];
  if (/^(?:help|stop)(?:[!.])?$/u.test(normalized)) return [99, 'immediate safety response'];
  if (/^(?:i (?:do not|don't) understand|(?:please )?(?:speak|say it|repeat).*(?:slow|again)|(?:can|could) you (?:repeat|speak more slowly))/u.test(normalized)) return [98, 'comprehension repair'];
  if (/^(?:i need (?:help|water)|(?:can|could) you help|(?:where is|where's) the (?:toilet|bathroom|restroom)|i (?:am|'m) (?:hungry|thirsty))/u.test(normalized)) return [97, 'basic need or access to help'];
  if (/^(?:(?:what is|what's) your name|my name is|i (?:do not|don't) know)/u.test(normalized)) return [92, 'identity or communicating a knowledge gap'];
  if (/\b(?:pinyin|hanzi|chinese character|mandarin tone)\b/u.test(normalized) && courseId !== 'zh') return [14, 'optional cross-language study context'];
  if (/\b(?:dragon|wizard|fairy|castle|magic|robot|spaceship|astronaut|alien)\b/u.test(normalized)) return [43, 'imagined or story context'];
  if (tokens.some(token => rare.has(token))) return [16, 'narrow specialist concept'];
  if (/\b(?:visa|permit|insurance|tax|contract|invoice|receipt|citizenship|appointment|budget|register)\b/u.test(normalized)) return [57, 'situational practical administration'];
  if (/\b(?:password|browser|software|download|upload|document|file|save|print)\b/u.test(normalized)) return [61, 'common digital or document task'];
  if (tokens.some(token => specialized.has(token))) return [33, 'technical or academic context'];
  if (!phrase && essential.has(head)) {
    if (['help','need','understand','water','stop'].includes(head)) return [98, 'essential reusable need or repair word'];
    if (['be','have','do','go','come','want','know','say','speak','yes','no','please'].includes(head)) return [94, 'highly reusable core word'];
    return [89, 'core everyday word'];
  }
  for (const [pattern, anchor, reason] of everydayDomains) {
    if (pattern.test(tokens.join(' '))) {
      let score = anchor;
      if (phrase && /^(?:please|can you|could you|where|how|when|i need|i want|let's|we need)\b/u.test(normalized)) score += 5;
      if (phrase && /\b(?:yesterday|last year|once|long ago)\b/u.test(normalized)) score -= 6;
      if (phrase && /\b(?:because|although|unless|whether|despite)\b/u.test(normalized)) score -= 3;
      return [score, reason];
    }
  }
  const family = semanticFamily(tokens, phrase);
  if (family) return [family[0], family[2]];
  if (!phrase && tokens.some(token => practical.has(token))) return [76, 'everyday concrete vocabulary'];
  if (specializedTopic.test(category)) return [38, 'specialized semantic family'];
  if (practicalTopic.test(category)) return [70, 'everyday semantic family'];
  if (tokens.some(token => abstract.has(token))) return [55, 'broader abstract communication'];
  if (phrase && tokens.some(token => essential.has(token) && !functional.has(token))) return [68, 'reusable everyday situation'];
  return [54, 'broader descriptive or enrichment content'];
}

function agreementFeatures(item = {}) {
  // Authored family IDs identify the grammatical operation, never a random
  // seed or a record-order rank.
  const family = [item.id, item.focus?.kind, item.focus?.targetText].join(' ');
  if (/(?:negative-do|small-quantity|\.annen|\.liten|\.dva|novy-plural|definite-surprises)/u.test(family)) return [57, 'irregular agreement or quantifier choice'];
  if (/(?:\.gammel|\.enkel|\.egen|\.min|\.muj|primer|feliz|past-be|negative-be|nuestro|trabajador)/u.test(family)) return [42, 'possessive, marked form or auxiliary agreement'];
  if (/(?:\.denne|\.ten|near|far|existential|present-be|adjective-pequeno|\.stor|\.velky|\.maly)/u.test(family)) return [21, 'basic demonstrative or adjective agreement'];
  return [31, 'productive agreement'];
}
function agreementUsefulness(item = {}) {
  const family = item.id || '';
  if (/(?:existential|present-be|negative-be|negative-do)/u.test(family)) return 92;
  if (/(?:near|far|\.ten|\.denne)/u.test(family)) return 88;
  if (/(?:\.min|\.muj|nuestro|small-quantity)/u.test(family)) return 83;
  return 77;
}
function languageDemand(target, courseId, reasons, formula) {
  let score = 0;
  const add = (condition, amount, label) => { if (condition) { score += amount; reasons.push(label); } };
  if (courseId === 'cz') {
    add(/\b(?:se|si|mi|ti|mu|mě|tě|nám|vám)\b/u.test(target) && !formula, 9, 'Czech clitic placement');
    add(/\b(?:bych|bys|bychom|byste|kdyby|kdybych|kdybychom)\b/u.test(target), 18, 'Czech conditional marking');
    add(/\b(?:který|která|které|protože|ačkoli|přestože|zatímco|aby|když)\b/u.test(target), 11, 'Czech subordinate clause');
    add(/(?:ěme|ejme|ujme)(?:\s|[!.])/u.test(target), 18, 'Czech plural invitation or command');
    add(/\b(?:s|se|k|ke|bez|od|pro|na|v|ve|o|po|před|za)\b/u.test(target) && !formula, 5, 'contextual Czech case selection');
  } else if (courseId === 'zh') {
    add(/[把被]/u.test(target), 23, 'Mandarin disposal or passive structure');
    add(/(?:如果|虽然|因为|所以|但是|不但|而且|无论|尽管)/u.test(target), 13, 'Mandarin clause linking');
    add(/(?:越.+越|一边.+一边|不仅.+还|既.+又)/u.test(target), 15, 'paired Mandarin construction');
    add(/(?:过|正在|已经|着)/u.test(target), 7, 'Mandarin aspect or temporal marking');
    add(/[的]/u.test(target) && !formula, 6, 'Mandarin attributive relation');
    add(/(?:根据|而不|方便|以便|为了)/u.test(target), 12, 'Mandarin purpose or embedded relation');
    add(/[了]/u.test(target), 5, 'contextual Mandarin le particle');
    add(/[得]/u.test(target), 10, 'Mandarin complement');
    add(/(?:起来|下去|出来|进去|回来|过去|完|到|好)/u.test(target) && !formula, 6, 'Mandarin result or direction distinction');
    add(/[个本张杯只条件辆位块把双]/u.test(target) && !formula, 5, 'Mandarin measure-word choice');
  } else if (courseId === 'es') {
    add(/\b(?:hubiera|hubiese|habría|habríamos|hubiéramos)\b/u.test(target), 24, 'Spanish compound counterfactual');
    add(/\b(?:ojalá|aunque|para que|a menos que|sin que|dondequiera que)\b/u.test(target), 14, 'Spanish mood or subordinate clause');
    add(/\b(?:que|cuando|donde)\b/u.test(target) && !formula, 8, 'Spanish embedded clause');
    add(/\b\p{Letter}{3,}(?:ara|iera|ase|iese)(?:n|mos)?\b/u.test(target), 20, 'Spanish imperfect subjunctive');
    add(/\b(?:me|te|se|lo|le|nos|les)\b/u.test(target) && !formula, 7, 'Spanish object or reflexive clitic');
    add(/\b(?:dámelo|dímelo|tráemelo|explícamelo|ayúdame|dígame|únete)\b/u.test(target), 14, 'Spanish attached imperative pronoun');
    add(/\b(?:he|has|ha|hemos|han|había|habían)\s+\p{Letter}+(?:ado|ido|to|cho)\b/u.test(target), 10, 'Spanish compound tense');
  } else if (courseId === 'nb') {
    add(/\b(?:fordi|selv om|dersom|mens|før|etter at|hvis|når)\b/u.test(target), 12, 'Bokmål subordinate word order');
    add(/\b(?:lurer|vet)\b.+\b(?:hvor|hva|hvem|hvordan)\b/u.test(target), 10, 'Bokmål embedded question');
    add(/\b(?:hadde|ville|skulle|kunne)\b/u.test(target), 10, 'Bokmål modal or compound tense');
    add(/\b(?:jo .+ desto|både .+ og|verken .+ eller)\b/u.test(target), 15, 'Bokmål paired construction');
    add(/\b(?:meg|deg|seg|oss)\b/u.test(target) && !formula, 6, 'Bokmål reflexive or object form');
    add(/\b(?:ta på|slå av|finne ut|gi opp|se etter|stå opp)\b/u.test(target), 10, 'Bokmål particle verb');
  } else if (courseId === 'es-en') {
    add(/\b(?:does not|doesn't|did not|didn't)\b/u.test(target) && !formula, 7, 'English auxiliary negation');
    add(/\b(?:has|have|had)\s+(?:been|lost|found|made|seen|taken|given|known|\p{Letter}+(?:ed|en))\b/u.test(target), 9, 'English perfect or compound verb');
    add(/\b(?:look after|give up|find out|put on|turn off|get along|look forward)\b/u.test(target), 10, 'English particle verb');
  }
  return score;
}
function sentenceComplexity(text, item, courseId, reasons) {
  const normalized = normalize(text), target = normalize(item.targetText || item.target || item.czech || item.text || '');
  const plain = plainMeaning(text);
  const fixed = firstContact.has(plain) || /^(?:help|stop)$/u.test(plain);
  const needFormula = needFormulaPattern.test(plain) || repairFormula.test(plain) || plain === 'please come in';
  let score = fixed ? 7 : needFormula ? 17 : 22;
  reasons.push(fixed ? 'fixed social response' : needFormula ? 'short reusable formula' : 'simple phrase or clause');
  if (!fixed && !needFormula) {
    if (/\b(?:am|is|are|was|were|have|has|does|do|can|will|must|should)\b/u.test(normalized)) score += 5;
    if (/\b(?:not|never|no longer|don't|doesn't|didn't)\b/u.test(normalized)) score += 5;
    if (/\b(?:because|although|unless|whether|despite|however|therefore|otherwise)\b/u.test(normalized)) { score += 15; reasons.push('clause relationship'); }
    else if (/\b(?:before|after|while|until|when|than|that|which|who)\b/u.test(normalized) && words(text).length > 5) score += 8;
    if (/\b(?:would|could have|should have|might have|had been|has been|have been)\b/u.test(normalized)) { score += 13; reasons.push('modal or compound tense'); }
    if (/\b(?:if|both|either|neither|each other|one another)\b/u.test(normalized)) score += 9;
    if (/\b(?:whenever|wherever|according to|instead of|as the|as we|as it)\b/u.test(normalized)) { score += 12; reasons.push('embedded contextual relation'); }
    if (/\b(?:we|you|they|he|she|it)\b.*\band\b.*\b(?:we|you|they|he|she|it|puts?|walked|went|made)\b/u.test(normalized)) score += 7;
    if (/\bto (?:paint|protect|see|carry|find|make|learn|practice|build|help)\b/u.test(normalized)) score += 7;
    if (/\b(?:the|a) \w+ (?:we|you|they|he|she)\b/u.test(normalized)) score += 11;
    if (/\b(?:makes? (?:it|the)|became|grew|thanked|missed|kept|divided)\b/u.test(normalized)) score += 7;
    if (words(text).some(token => abstract.has(inflectionBase(token)))) score += 7;
    if (words(text).some(token => specialized.has(inflectionBase(token)))) score += 9;
    // Small workload refinement after grammatical analysis, never the sole grade.
    score += Math.min(9, Math.max(0, Math.floor((words(text).length - 6) / 3)) * 3);
  }
  score += languageDemand(target, courseId, reasons, fixed || needFormula);
  if (/^(?:had|were)\b.+,.*\b(?:would|could|might)\b/u.test(normalized)
      || /\b(?:would|could|might) have\b.*\bif\b/u.test(normalized)
      || /\bif\b.*\bhad\b.*\b(?:would|could|might)\b/u.test(normalized)) {
    score = Math.max(score, 89); reasons.push('counterfactual with interacting clause and tense demands');
  }
  if (/^the (?:more|less|earlier|later|longer|sooner)\b.*\bthe (?:more|less|better|worse|longer|sooner)\b/u.test(normalized)) {
    score = Math.max(score, 78); reasons.push('correlative comparison and clause ordering');
  }
  if (courseId === 'zh' && /[把被]/u.test(target)) score = Math.max(score, 58);
  if (courseId === 'cz' && /(?:ěme|ejme|ujme)(?:\s|[!.])/u.test(target) && /\b(?:se|si)\b/u.test(target)) score = Math.max(score, 57);
  if (needFormula && /^(?:where|what|how|when)\b/u.test(plain)) score += 6;
  if (needFormula && courseId === 'zh' && /(?:一遍|一次)/u.test(target)) score += 7;
  if (needFormula && courseId === 'es' && /(?:habla|diga|dime|repita|repite)/u.test(target)) score += 6;
  if (item.phase === 'transfer' || item.phase === 'assessment') { score += 7; reasons.push('transfer or assessment context'); }
  if (item.contrastGroupId) { score += 13; reasons.push('authored listening contrast'); }
  // Relative to the retained badge's assumed background. Formulaic phrases
  // stay easy; unfamiliar marked operations still contribute independently.
  if (!fixed && !needFormula) score -= 3 * Math.max(0, Number(item.difficulty || 1) - 1);
  return score;
}

export function proposeProgression({ item, kind, parent, detail = '', courseId = '' }) {
  const english = englishAuditText(item) || englishAuditText(parent || {});
  const category = normalize(item.category || item.cat || item.topic || parent?.category || '');
  const phrase = ['sentence', 'agreement-example', 'case-context', 'listening-sentence'].includes(kind);
  let [usefulness, purpose] = lexicalUsefulness(english, category, phrase, courseId);
  const reasons = [purpose];
  const target = normalize(item.targetText || item.target || item.cs || item.text || item.verb || item.hanzi || '');
  const descriptors = normalize([item.kind, item.family, item.lessonId, item.hint, ...(item.tags || [])].join(' '));
  let complexity = 20;
  if (phrase) complexity = sentenceComplexity(english, item, courseId, reasons);
  else {
    const head = lexemeHead(english), tokens = words(head).map(inflectionBase);
    if (firstContact.has(head) || functional.has(head)) complexity = 9;
    else if (essential.has(head)) complexity = 15;
    else if (tokens.some(token => practical.has(token))) complexity = 21;
    else complexity = 29;
    const family = semanticFamily(tokens, false);
    if (family && !essential.has(head) && !functional.has(head)) complexity = family[1];
    if (tokens.some(token => abstract.has(token))) { complexity += 17; reasons.push('abstract meaning'); }
    if (tokens.some(token => specialized.has(token))) { complexity += 17; reasons.push('domain-specific distinction'); }
    if (tokens.some(token => rare.has(token))) complexity += 24;
    if (/[;/]|\sor\s/u.test(english)) { complexity += 8; reasons.push('multiple sense cues'); }
    if (words(head).length > 1) complexity += Math.min(10, (words(head).length - 1) * 3);
    if (/(reflexive|phrasal|motion→|ipf→|modal-like)/u.test(descriptors) || /(?:\sse|\ssi)$/u.test(target)) complexity += 11;
    if (/(?:take care|look after|put up|give up|find out|get along|look forward|carry out|come up|deal with|turn out|make up|set up)/u.test(head)) complexity += 14;
    if (item.contrastGroupId) complexity += 13;
  }
  if (kind === 'conjugation') {
    const irregular = /irregular|stem.chang|supplet|present-(?:e-i|e-ie|o-ue|g-j|zco|uir|poner|tener|seguir)/u.test(descriptors)
      || courseId === 'nb' && irregularBokmal.has(target) || spanishStemChanges.has(target);
    complexity = irregular ? 51 : 26;
    if (/supplet/u.test(descriptors) || ['být','jít','ser','ir','be','være'].includes(target)) complexity += 9;
    if (/reflexive/u.test(descriptors) || /(?:\sse|\ssi)$/u.test(target)) complexity += 12;
    if (/modal/u.test(descriptors)) complexity += 6;
    if (/perfective|motion|aspect/u.test(descriptors) && !/imperfective/u.test(descriptors)) complexity += 7;
    reasons.push(irregular ? 'irregular conjugation family' : 'regular productive conjugation');
  } else if (kind === 'conjugation-form') {
    const base = proposeProgression({ item: parent, kind: 'conjugation', courseId });
    usefulness = base.usefulness;
    complexity = base.complexity;
    if (/plural|P[123]/u.test(detail)) complexity += 6;
    if (/(?:^|-)formal(?:-|$)/u.test(detail)) complexity += 4;
    if (/perfect/u.test(detail)) complexity += 8;
    if (/P[23]|third/u.test(detail)) complexity += 3;
    reasons.push('parent conjugation demand', detail);
  } else if (kind === 'agreement' || kind === 'agreement-form') {
    const family = kind === 'agreement' ? item : parent;
    usefulness = agreementUsefulness(family);
    const [base, reason] = agreementFeatures(family);
    complexity = base + (/plural/u.test(detail) ? 6 : 0) + (/neuter/u.test(detail) ? 3 : 0);
    reasons.push(reason, detail);
  } else if (kind === 'agreement-example') {
    usefulness = Math.min(agreementUsefulness(parent), usefulness);
    const [base, reason] = agreementFeatures(parent);
    complexity = Math.max(complexity, base - 7);
    if (/plural/u.test(detail)) complexity += 4;
    if (/neuter/u.test(detail)) complexity += 2;
    reasons.push(reason, 'contextual agreement');
  } else if (kind === 'case-paradigm') {
    usefulness = item.number === 'plural' ? 72 : 79;
    complexity = item.number === 'plural' ? 47 : 32;
    if (/animate/u.test(item.animacy || item.id || '') && !/inanimate/u.test(item.animacy || item.id || '')) complexity += 7;
    reasons.push('case paradigm and number');
  } else if (kind === 'case-context') {
    const caseGrade = { Nominative: 18, Accusative: 29, Genitive: 42, Dative: 45, Locative: 40, Instrumental: 46, Vocative: 56 }[detail] || 29;
    complexity = Math.max(complexity, caseGrade);
    if (item.acceptedForms?.length > 1) complexity += 5;
    if (/plural/u.test(item.paradigmId || '')) complexity += 8;
    reasons.push('case role and alternatives', detail);
  } else if (kind === 'character') {
    // No invented stroke counts: existing single-character sound and meaning
    // cues support only phonological/semantic distinctions in this pass.
    complexity = 20;
    if (words(english).some(token => abstract.has(token))) complexity += 14;
    if (words(english).some(token => specialized.has(token))) complexity += 14;
    if (/[;]/u.test(item.translation)) complexity += 7;
    if (item.tone === 3) complexity += 5;
    if (item.tone === 5) complexity += 8;
    if (/^(?:zh|ch|sh|r)/u.test(normalize(item.pinyin))) complexity += 4;
    if (/[üǖǘǚǜ]/u.test(item.pinyin || '')) complexity += 5;
    reasons.push('character sound-meaning recognition');
  } else if (kind === 'noun') {
    if (genderExceptions.has(target)) { complexity += 21; reasons.push('nontransparent gender'); }
    if (item.acceptedLaneIds?.length > 1) complexity += 8;
    if (/\birregular\b/u.test(descriptors) || irregularNouns.test(normalize(english))) complexity += 15;
    reasons.push('noun category recognition');
  }
  return { usefulness: clamp(usefulness), complexity: clamp(complexity), reason: reasons.filter(Boolean).join('; ') };
}
