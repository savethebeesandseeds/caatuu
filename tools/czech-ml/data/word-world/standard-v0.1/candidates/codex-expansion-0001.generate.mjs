import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const batchDir = path.join(root, "tools/czech-ml/data/word-world/standard-v0.1/candidates");
const coveragePath = path.join(root, "tools/czech-ml/data/word-world/standard-v0.1/reports/coverage.json");
const canonicalPath = path.join(root, "tools/czech-ml/data/word-world/standard-v0.1/source/common-phrases-pilot.jsonl");
const coreDictionaryPath = path.join(root, "apps/languages/czech/static/data/dictionary.json");
const outputPath = path.join(batchDir, "codex-expansion-0001.candidates.jsonl");
const manifestPath = path.join(batchDir, "codex-expansion-0001.manifest.json");
const reportPath = path.join(batchDir, "codex-expansion-0001.authoring-report.json");

const rows = [
  [1,"people","Můj bratr běhá.","My brother runs.","bratr","present"],
  [1,"people","Bojím se tmy.","The dark scares me.","Bojím","reflexive_present"],
  [1,"people","Teď mě bolí břicho.","My stomach hurts now.","břicho","body_and_health"],
  [1,"people","Cítím se dobře.","I feel good.","Cítím","reflexive_present"],
  [1,"people","Po škole mám hlad.","After school I am hungry.","hlad","have_expression"],
  [1,"people","Dnes mě bolí hlava.","My head hurts today.","hlava","body_and_health"],
  [2,"people","Můj bráška si staví věž.","My little brother is building a tower.","bráška","possessive_present"],
  [2,"people","Ten pes je ještě malý.","That dog is still small.","malý","copular_adjective"],
  [2,"people","Děti si navzájem pomáhají.","The children help each other.","navzájem","reciprocal_present"],
  [2,"people","Pan Novák má dnes hodně práce.","Mr. Novák has a lot of work today.","práce","have_expression"],
  [2,"people","Tomáš má z výletu radost.","Tomáš is happy about the trip.","radost","have_expression"],
  [2,"people","Ema je před závodem nervózní.","Ema is nervous before the race.","nervózní","copular_adjective"],
  [2,"people","Petr je na svůj obrázek pyšný.","Petr is proud of his picture.","obrázek","prepositional_phrase"],
  [2,"people","Naše rodina večeří spolu.","Our family eats dinner together.","rodina","possessive_present"],
  [2,"people","O víkendu navštívíme rodinu.","We will visit family at the weekend.","rodinu","future_perfective"],
  [2,"people","Náš soused má milého psa.","Our neighbor has a friendly dog.","soused","possessive_present"],
  [2,"people","Náš tým dnes trénuje venku.","Our team practices outside today.","tým","possessive_present"],
  [2,"people","Učitel píše slovo na tabuli.","The teacher writes a word on the board.","Učitel","present_prepositional"],
  [2,"people","Moji kamarádi čekají před školou.","My friends are waiting outside school.","kamarádi","possessive_present"],
  [2,"people","Nesu knihu kamarádovi.","I am bringing a book to my friend.","knihu","dative_object"],
  [2,"people","Anička čte krátký příběh.","Anička is reading a short story.","čte","present_object"],
  [2,"people","Tatínek přichází domů v šest.","Dad is coming home at six.","přichází","present_time"],
  [2,"people","Miminko klidně spí v postýlce.","The baby is sleeping peacefully in the crib.","spí","present_prepositional"],
  [2,"people","Dědeček vaří polévku k obědu.","Grandpa is cooking soup for lunch.","vaří","present_object"],
  [2,"people","Kláře chybí babička.","Klára misses Grandma.","babička","dative_experiencer"],

  [1,"home","Tady je klíč.","Here is the key.","klíč","presentative"],
  [1,"home","Taška je těžká.","The bag is heavy.","Taška","copular_adjective"],
  [1,"home","Stůl je čistý.","The table is clean.","Stůl","copular_adjective"],
  [1,"home","Pohovka je měkká.","The sofa is soft.","Pohovka","copular_adjective"],
  [1,"home","Tady je mokrá podlaha.","The floor is wet here.","podlaha","copular_adjective"],
  [1,"home","Větrák je zapnutý.","The fan is on.","Větrák","copular_adjective"],
  [2,"home","Klíče leží vedle dveří.","The keys are lying beside the door.","Klíče","location_present"],
  [2,"home","Dej papír do koše.","Put the paper in the bin.","Dej","imperative_motion","imperative"],
  [2,"home","Ráno krmím naši kočku.","I feed our cat in the morning.","kočku","present_object"],
  [2,"home","Po večeři umyjeme nádobí.","We will wash the dishes after dinner.","nádobí","future_perfective"],
  [2,"home","Utři prosím mokrou podlahu.","Please wipe the wet floor.","podlahu","imperative_object","imperative"],
  [2,"home","Kniha patří na horní polici.","The book belongs on the top shelf.","polici","location_present"],
  [2,"home","Posbírej kostky z koberce.","Pick up the blocks from the rug.","Posbírej","imperative_object","imperative"],
  [2,"home","Přesuň rostlinu blíž k oknu.","Move the plant closer to the window.","rostlinu","imperative_motion","imperative"],
  [2,"home","Rozsviť lampu u postele.","Turn on the lamp by the bed.","Rozsviť","imperative_object","imperative"],
  [2,"home","Zalij malou květinu na stole.","Water the small flower on the table.","Zalij","imperative_object","imperative"],
  [2,"home","Zameť drobky pod stolem.","Sweep the crumbs under the table.","Zameť","imperative_object","imperative"],
  [2,"home","Vynes prosím plný koš.","Please take out the full bin.","Vynes","imperative_object","imperative"],
  [2,"home","Pokoj je teď uklizený.","The room is tidy now.","uklizený","copular_adjective"],
  [2,"home","Budeme spolu uklízet kuchyň.","We will clean the kitchen together.","uklízet","future_imperfective"],
  [2,"home","Utři vodu u vany.","Wipe up the water by the bath.","Utři","imperative_object","imperative"],
  [2,"home","Hračky jsou v modré krabici.","The toys are in the blue box.","Hračky","location_present"],
  [2,"home","Tato deka je velmi měkká.","This blanket is very soft.","měkká","copular_adjective"],
  [2,"home","Můj stůl je dnes neuklizený.","My desk is messy today.","neuklizený","possessive_copular"],
  [2,"home","Hodiny jdou o minutu napřed.","The clock is one minute fast.","jdou","time_expression"],

  [1,"food","Banány jsou žluté.","Bananas are yellow.","Banány","copular_adjective"],
  [1,"food","Hrnek je prázdný.","The mug is empty.","Hrnek","copular_adjective"],
  [1,"food","Tato polévka je teplá.","This soup is warm.","Polévka","copular_adjective"],
  [1,"food","Talíř je čistý.","The plate is clean.","Talíř","copular_adjective"],
  [1,"food","Naše snídaně je hotová.","Our breakfast is ready.","Snídaně","copular_adjective"],
  [1,"food","Tady je pití.","Here is a drink.","pití","presentative"],
  [2,"food","Maminka krájí cibuli do polévky.","Mom is chopping an onion for the soup.","Maminka","present_object"],
  [2,"food","Chléb je dnes čerstvý.","The bread is fresh today.","čerstvý","copular_adjective"],
  [2,"food","Nalij mi trochu džusu.","Pour me some juice.","džusu","imperative_dative","imperative"],
  [2,"food","Kakao je ještě horké.","The cocoa is still hot.","horké","copular_adjective"],
  [2,"food","Oběd bude brzy hotový.","Lunch will be ready soon.","hotový","future_copular"],
  [2,"food","Tahle omáčka mi chutná.","I like this sauce.","chutná","dative_experiencer"],
  [2,"food","Dáme jablka do misky.","We will put the apples in a bowl.","jablka","future_perfective"],
  [2,"food","Polož lžíci vedle talíře.","Put the spoon beside the plate.","lžíci","imperative_location","imperative"],
  [2,"food","Džbán je plný vody.","The jug is full of water.","vody","copular_genitive"],
  [2,"food","Podej mi prosím chléb.","Please pass me the bread.","Podej","imperative_dative","imperative"],
  [2,"food","Můžeme se podělit o sušenku.","We can share a cookie.","podělit","modal_infinitive"],
  [2,"food","David rozlil mléko na stůl.","David spilled milk on the table.","stůl","past_masculine"],
  [2,"food","Mléko je příliš studené.","The milk is too cold.","studené","copular_adjective"],
  [2,"food","Vezmi si jednu sušenku.","Take one cookie.","sušenku","imperative_object","imperative"],
  [2,"food","Teplá polévka krásně voní.","The warm soup smells lovely.","Teplá","adjective_agreement"],
  [2,"food","Nejez prosím tak rychle.","Please do not eat so fast.","rychle","negative_imperative","imperative"],
  [2,"food","Nejez zelené bobule.","Do not eat green berries.","Nejez","negative_imperative","imperative"],
  [2,"food","Omyj jablko pod vodou.","Wash the apple under water.","Omyj","imperative_object","imperative"],
  [2,"food","Přidej do čaje trochu medu.","Add a little honey to the tea.","trochu","imperative_quantity","imperative"],

  [1,"school","Sem napiš své jméno.","Write your name here.","jméno","imperative_object","imperative"],
  [1,"school","Vezmi si tužku.","Take a pencil.","tužku","imperative_object","imperative"],
  [1,"school","Sleduj tabuli.","Watch the board.","tabuli","imperative_location","imperative"],
  [1,"school","Mám jednu otázku.","I have one question.","otázku","have_expression"],
  [1,"school","Úkol je krátký.","The task is short.","Úkol","copular_adjective"],
  [1,"school","Přečti tuto větu.","Read this sentence.","větu","imperative_object","imperative"],
  [2,"school","Tereza hláskuje své příjmení.","Tereza is spelling her surname.","hláskuje","present_object"],
  [2,"school","Přečti první odstavec nahlas.","Read the first paragraph aloud.","nahlas","imperative_manner","imperative"],
  [2,"school","Opakuj prosím celé slovo.","Please repeat the whole word.","Opakuj","imperative_object","imperative"],
  [2,"school","Poslouchej krátký rozhovor.","Listen to the short conversation.","Poslouchej","imperative_object","imperative"],
  [2,"school","Čti zadání opravdu pozorně.","Read the instructions very carefully.","pozorně","imperative_manner","imperative"],
  [2,"school","Pracuj chvíli ve dvojici.","Work with a partner for a while.","Pracuj","imperative_prepositional","imperative"],
  [2,"school","Řekni odpověď celou větou.","Say the answer in a full sentence.","Řekni","imperative_instrumental","imperative"],
  [2,"school","Umíš spočítat tyto hvězdy?","Can you count these stars?","Umíš","modal_question","question"],
  [2,"school","Ještě nevím správnou odpověď.","I do not know the right answer yet.","nevím","negative_present"],
  [2,"school","Kdo chce odpovědět jako první?","Who wants to answer first?","odpovědět","modal_question","question"],
  [2,"school","Můžeš mi vysvětlit tento příklad?","Can you explain this example to me?","vysvětlit","modal_question","question"],
  [2,"school","Zkus vyhláskovat své příjmení.","Try to spell your surname.","vyhláskovat","imperative_infinitive","imperative"],
  [2,"school","Matěj špatně pochopil otázku.","Matěj misunderstood the question.","otázku","past_masculine"],
  [2,"school","Hodina skončila přesně v deset.","The lesson ended exactly at ten.","skončila","past_feminine"],
  [2,"school","Naše hodina začíná v osm.","Our lesson starts at eight.","hodina","possessive_time"],
  [2,"school","Zkontroluj poslední řádek v sešitě.","Check the last line in the notebook.","Zkontroluj","imperative_object","imperative"],
  [2,"school","Sedím vedle kamaráda.","I sit next to my friend.","vedle","location_present"],
  [2,"school","Požádáme učitele o pomoc.","We will ask the teacher for help.","pomoc","future_perfective"],
  [2,"school","Najdi v textu jednu chybu.","Find one mistake in the text.","Najdi","imperative_location","imperative"],

  [1,"play","Mám dva míče.","I have two balls.","míče","have_expression"],
  [1,"play","Zpívám krátkou písničku.","I sing a short song.","písničku","present_object"],
  [1,"play","Čteme krátký příběh.","We read a short story.","příběh","present_object"],
  [1,"play","Věž je vysoká.","The tower is tall.","Věž","copular_adjective"],
  [1,"play","Chybí jeden dílek.","One piece is missing.","dílek","present_quantity"],
  [1,"play","Nakresli malou květinu.","Draw a small flower.","květinu","imperative_object","imperative"],
  [2,"play","Chyť modrý míč oběma rukama.","Catch the blue ball with both hands.","Chyť","imperative_instrumental","imperative"],
  [2,"play","Kopni míč mezi dva kužely.","Kick the ball between two cones.","Kopni","imperative_motion","imperative"],
  [2,"play","Hoď kostkou ještě jednou.","Roll the die one more time.","Hoď","imperative_instrumental","imperative"],
  [2,"play","Najdi všechny žluté hvězdy.","Find all the yellow stars.","Najdi","imperative_object","imperative"],
  [2,"play","Nakresli dům vedle stromu.","Draw a house beside the tree.","Nakresli","imperative_location","imperative"],
  [2,"play","Postav most ze čtyř kostek.","Build a bridge with four blocks.","Postav","imperative_material","imperative"],
  [2,"play","Vybarvi střechu červenou pastelkou.","Color the roof with a red pencil.","Vybarvi","imperative_instrumental","imperative"],
  [2,"play","Zazpívej první sloku pomalu.","Sing the first verse slowly.","Zazpívej","imperative_manner","imperative"],
  [2,"play","Začni od zeleného políčka.","Start at the green square.","Začni","imperative_prepositional","imperative"],
  [2,"play","Tahle hra je opravdu zábavná.","This game is really fun.","zábavná","copular_adjective"],
  [2,"play","Teď je řada na tobě.","Now it is your turn.","tobě","prepositional_phrase"],
  [2,"play","Modrá figurka je tvoje.","The blue piece is yours.","tvoje","possessive_pronoun"],
  [2,"play","Střídejme se po jednom tahu.","Let us take turns after each move.","Střídejme","hortative_imperative","imperative"],
  [2,"play","Najdi chybějící dílek skládačky.","Find the missing puzzle piece.","chybějící","imperative_object","imperative"],
  [2,"play","Tancuj do rytmu této písničky.","Dance to the rhythm of this song.","Tancuj","imperative_prepositional","imperative"],
  [2,"play","Slož papír podle obrázku.","Fold the paper as shown in the picture.","Slož","imperative_object","imperative"],
  [2,"play","Pověs obrázek nad stůl.","Hang the picture above the table.","Pověs","imperative_location","imperative"],
  [2,"play","Vyberme si novou hru.","Let us choose a new game.","Vyberme","hortative_imperative","imperative"],
  [2,"play","Uděláme tým ze tří hráčů.","We will make a team of three players.","tým","future_perfective"],

  [1,"transport","Auto je modré.","The car is blue.","Auto","copular_adjective"],
  [1,"transport","Vlak přijíždí.","The train is arriving.","Vlak","present_motion"],
  [1,"transport","Loď pluje pomalu.","The boat sails slowly.","Loď","present_motion"],
  [1,"transport","Letadlo letí vysoko.","The plane flies high.","Letadlo","present_motion"],
  [1,"transport","Kolo je nové.","The bike is new.","Kolo","copular_adjective"],
  [1,"transport","Cesta je volná.","The road is clear.","Cesta","copular_adjective"],
  [2,"transport","V autě máme dvě tašky.","We have two bags in the car.","autě","location_present"],
  [2,"transport","V autobuse sedím u okna.","I sit by the window on the bus.","autobuse","location_present"],
  [2,"transport","Cesta do školy je dlouhá.","The journey to school is long.","dlouhá","copular_adjective"],
  [2,"transport","Jeď pomalu kolem parku.","Ride slowly around the park.","Jeď","imperative_motion","imperative"],
  [2,"transport","Nad městem letí malé letadlo.","A small plane is flying over the city.","letí","present_motion"],
  [2,"transport","Tohle není mé sedadlo.","This is not my seat.","mé","negative_possessive"],
  [2,"transport","Přisedni si prosím k oknu.","Please take a seat by the window.","oknu","imperative_motion","imperative"],
  [2,"transport","Přejdi ulici na přechodu.","Cross the street at the crossing.","Přejdi","imperative_motion","imperative"],
  [2,"transport","Připoutej se před jízdou.","Fasten your seatbelt before the ride.","Připoutej","reflexive_imperative","imperative"],
  [2,"transport","Autobus zastaví za rohem.","The bus will stop around the corner.","Autobus","future_perfective"],
  [2,"transport","Na nádraží je ráno rušno.","The station is busy in the morning.","rušno","impersonal_location"],
  [2,"transport","Jdeme po tiché ulici.","We are walking along a quiet street.","ulici","present_motion"],
  [2,"transport","Na zastávce čekáme venku.","We wait outside at the stop.","venku","location_present"],
  [2,"transport","Ve vlaku hledáme volné místo.","We are looking for a free seat on the train.","vlaku","location_present"],
  [2,"transport","Potřebuji vystoupit na příští zastávce.","I need to get off at the next stop.","vystoupit","modal_infinitive"],
  [2,"transport","Vlak má malé zpoždění.","The train has a short delay.","zpoždění","have_expression"],
  [2,"transport","Před přechodem počkej na zelenou.","Wait for the green light before crossing.","zelenou","imperative_prepositional","imperative"],
  [2,"transport","Nezapomeň si cestovní kartu.","Do not forget your travel card.","Nezapomeň","negative_imperative","imperative"],
  [2,"transport","Tento autobus je úplně plný.","This bus is completely full.","autobus","copular_adjective"],

  [1,"location","Škola je blízko.","The school is nearby.","blízko","location_copular"],
  [1,"location","Nádraží je daleko.","The station is far away.","daleko","location_copular"],
  [1,"location","Na rohu zaboč doleva.","Turn left at the corner.","doleva","imperative_direction","imperative"],
  [1,"location","U parku zaboč doprava.","Turn right by the park.","doprava","imperative_direction","imperative"],
  [1,"location","Pokračuj prosím rovně.","Please continue straight.","rovně","imperative_direction","imperative"],
  [1,"location","Park je otevřený.","The park is open.","Park","copular_adjective"],
  [2,"location","Míč leží za krabicí.","The ball is behind the box.","krabicí","location_present"],
  [2,"location","Lékárna je vedle knihovny.","The pharmacy is beside the library.","vedle","location_copular"],
  [2,"location","Kavárna je na rohu.","The café is on the corner.","rohu","location_copular"],
  [2,"location","Klíče leží na stole.","The keys are on the table.","stole","location_present"],
  [2,"location","Autobusová zastávka je tamhle.","The bus stop is over there.","tamhle","location_copular"],
  [2,"location","Půjdu tam s tebou.","I will go there with you.","tebou","future_motion"],
  [2,"location","Naše třída je vpravo.","Our classroom is on the right.","třída","possessive_location"],
  [2,"location","Záchod je na konci chodby.","The toilet is at the end of the hall.","Záchod","location_copular"],
  [2,"location","Batoh je pod židlí.","The backpack is under the chair.","židlí","location_copular"],
  [2,"location","Ukážu ti kratší cestu.","I will show you a shorter route.","cestu","future_dative"],
  [2,"location","Pojď prosím dovnitř.","Please come inside.","dovnitř","imperative_direction","imperative"],
  [2,"location","Věž stojí u řeky.","The tower stands by the river.","Věž","location_present"],
  [2,"location","Můžeme se sejít u školy.","We can meet by the school.","sejít","modal_reflexive"],
  [2,"location","Knihovna je naproti škole.","The library is opposite the school.","škole","location_copular"],
  [2,"location","Kolo stojí před domem.","The bike is in front of the house.","Kolo","location_present"],
  [2,"location","Chlapec se cestou domů ztratil.","The boy got lost on his way home.","domů","past_masculine"],
  [2,"location","Můžeme se zeptat na cestu.","We can ask for directions.","zeptat","modal_reflexive"],
  [2,"location","Přiveď psa dovnitř.","Bring the dog inside.","psa","imperative_direction","imperative"],
  [2,"location","Ustup prosím od dveří.","Please step away from the door.","Ustup","imperative_direction","imperative"],

  [1,"weather","Deštník je mokrý.","The umbrella is wet.","Deštník","copular_adjective"],
  [1,"weather","Čepice je teplá.","The hat is warm.","Čepice","copular_adjective"],
  [1,"weather","Bunda je suchá.","The jacket is dry.","Bunda","copular_adjective"],
  [1,"weather","Dnes je obloha modrá.","The sky is blue today.","obloha","copular_adjective"],
  [1,"weather","Vítr fouká.","The wind is blowing.","Vítr","weather_present"],
  [1,"weather","Dnes prší.","It is raining today.","prší","weather_present"],
  [2,"weather","Vezmi si teplou bundu.","Put on a warm jacket.","bundu","imperative_clothing","imperative"],
  [2,"weather","Nasaď si modrou čepici.","Put on the blue hat.","čepici","imperative_clothing","imperative"],
  [2,"weather","Venku silně fouká.","It is very windy outside.","fouká","weather_present"],
  [2,"weather","Moje nová pláštěnka je modrá.","My new raincoat is blue.","modrá","possessive_copular"],
  [2,"weather","Boty jsou po dešti mokré.","The shoes are wet after the rain.","mokré","copular_adjective"],
  [2,"weather","Odpoledne bude slunečno.","It will be sunny in the afternoon.","slunečno","future_weather"],
  [2,"weather","Za oknem tiše sněží.","It is snowing quietly outside the window.","sněží","weather_present"],
  [2,"weather","Ten zelený svetr je teplý.","That green sweater is warm.","svetr","copular_adjective"],
  [2,"weather","Dnes potřebuji teplý kabát.","I need a warm coat today.","teplý","modal_present"],
  [2,"weather","Tyto kalhoty jsou příliš dlouhé.","These trousers are too long.","kalhoty","copular_adjective"],
  [2,"weather","Bílá košile visí ve skříni.","The white shirt hangs in the wardrobe.","košile","location_present"],
  [2,"weather","Najdi obě modré ponožky.","Find both blue socks.","ponožky","imperative_object","imperative"],
  [2,"weather","Anna si obléká nové šaty.","Anna is putting on a new dress.","šaty","present_clothing"],
  [2,"weather","Pláštěnka je už čistá.","The raincoat is clean now.","čistá","copular_adjective"],
  [2,"weather","Přines dovnitř suché ručníky.","Bring the dry towels inside.","suché","imperative_clothing","imperative"],
  [2,"weather","Moje boty jsou ještě špinavé.","My shoes are still dirty.","špinavé","possessive_copular"],
  [2,"weather","Na výlet máme špatné počasí.","We have bad weather for the trip.","špatné","have_expression"],
  [2,"weather","Ráno bude zataženo.","It will be cloudy in the morning.","zataženo","future_weather"],
  [2,"weather","Připrav si suché oblečení.","Prepare some dry clothes.","oblečení","imperative_clothing","imperative"],

  [1,"time","Je právě dvanáct.","It is exactly twelve.","dvanáct","time_expression"],
  [1,"time","Hodina začíná.","The lesson is starting.","Hodina","time_present"],
  [1,"time","Je poledne.","It is noon.","poledne","time_expression"],
  [1,"time","Škola začíná v pondělí.","School starts on Monday.","pondělí","time_expression"],
  [1,"time","Hra je v úterý.","The game is on Tuesday.","úterý","time_expression"],
  [1,"time","Včera pršelo.","It rained yesterday.","Včera","past_neuter"],
  [1,"time","Týden má sedm dní.","A week has seven days.","Týden","time_quantity"],
  [2,"time","Do oběda máme dost času.","We have enough time before lunch.","času","time_quantity"],
  [2,"time","Knihovna zavírá v pět hodin.","The library closes at five o'clock.","hodin","time_expression"],
  [2,"time","Přijdu za deset minut.","I will come in ten minutes.","minut","future_time"],
  [2,"time","Počkej prosím jednu minutu.","Please wait one minute.","minutu","imperative_time","imperative"],
  [2,"time","Začneme ještě jednu hru.","We will start one more game.","jednu","future_quantity"],
  [2,"time","Odcházíme z domu v osm.","We leave home at eight.","Odcházíme","present_time"],
  [2,"time","Pospěš si na autobus.","Hurry to the bus.","Pospěš","reflexive_imperative","imperative"],
  [2,"time","Přijdu domů před večeří.","I will come home before dinner.","Přijdu","future_time"],
  [2,"time","Autobus přijede za pět minut.","The bus will arrive in five minutes.","přijede","future_time"],
  [2,"time","Příští týden jedeme na výlet.","We are going on a trip next week.","Příští","future_plan"],
  [2,"time","Film skončil před deseti minutami.","The film ended ten minutes ago.","skončil","past_masculine"],
  [2,"time","Trénink začíná hned po škole.","Practice starts right after school.","začíná","time_present"],
  [2,"time","Do přestávky zbývá pět minut.","Five minutes remain until the break.","zbývá","time_quantity"],
  [2,"time","Zpomal prosím u zatáčky.","Please slow down at the bend.","Zpomal","imperative_manner","imperative"],
  [2,"time","Každé ráno vstávám v sedm.","I get up at seven every morning.","vstávám","routine_present"],
  [2,"time","Potřebuji zítra vstávat brzy.","I need to get up early tomorrow.","vstávat","modal_infinitive"],
  [2,"time","O víkendu snídám s rodinou.","I eat breakfast with my family at weekends.","snídám","routine_present"],
  [2,"time","Večeřím obvykle kolem šesté.","I usually eat dinner around six.","Večeřím","routine_present"],

  [1,"technology","Baterie je nabitá.","The battery is charged.","Baterie","copular_adjective"],
  [1,"technology","Internet funguje.","The internet works.","Internet","present"],
  [1,"technology","Počítač je vypnutý.","The computer is off.","Počítač","copular_adjective"],
  [1,"technology","Tablet je nový.","The tablet is new.","Tablet","copular_adjective"],
  [1,"shopping","Mám peníze.","I have money.","peníze","have_expression"],
  [1,"technology","Heslo je tajné.","The password is secret.","Heslo","copular_adjective"],
  [1,"technology","Zvuk je tichý.","The sound is quiet.","Zvuk","copular_adjective"],
  [2,"technology","Nabij telefon před výletem.","Charge the phone before the trip.","Nabij","imperative_object","imperative"],
  [2,"technology","Stránka se pomalu načítá.","The page is loading slowly.","načítá","reflexive_present"],
  [2,"technology","Obrazovka je příliš jasná.","The screen is too bright.","Obrazovka","copular_adjective"],
  [2,"technology","Pošli babičce krátkou zprávu.","Send Grandma a short message.","Pošli","imperative_dative","imperative"],
  [2,"technology","Stiskni zelené tlačítko.","Press the green button.","Stiskni","imperative_object","imperative"],
  [2,"technology","Toto tlačítko otevírá menu.","This button opens the menu.","tlačítko","present_object"],
  [2,"technology","Ulož obrázek do složky.","Save the picture in the folder.","Ulož","imperative_location","imperative"],
  [2,"technology","Moje baterie je skoro vybitá.","My battery is almost empty.","vybitá","possessive_copular"],
  [2,"technology","Telefon je přes noc vypnutý.","The phone is off overnight.","vypnutý","copular_adjective"],
  [2,"technology","Zapni prosím stolní lampu.","Please turn on the desk lamp.","Zapni","imperative_object","imperative"],
  [2,"technology","Přečti si novou zprávu.","Read the new message.","zprávu","imperative_object","imperative"],
  [2,"technology","Vyfoť mapu u vchodu.","Photograph the map by the entrance.","Vyfoť","imperative_object","imperative"],
  [2,"technology","Klepni na modrou ikonu.","Tap the blue icon.","Klepni","imperative_location","imperative"],
  [2,"technology","Nejdřív zavři všechna okna.","First close all the windows.","Nejdřív","imperative_sequence","imperative"],
  [2,"technology","Nikomu nesdílej své heslo.","Do not share your password with anyone.","nesdílej","negative_imperative","imperative"],
  [2,"technology","Přes sluchátka tě neslyším.","I cannot hear you through the headphones.","neslyším","negative_present"],
  [2,"technology","Budík je příliš hlasitý.","The alarm is too loud.","hlasitý","copular_adjective"],
  [2,"technology","Starý počítač je trochu pomalý.","The old computer is a little slow.","pomalý","copular_adjective"]
];

const topicMeta = {
  people: ["describe people and feelings", "people_and_feelings"], home: ["name and manage home objects", "home_and_chores"],
  food: ["talk about food and meals", "food_and_meals"], school: ["follow classroom language", "classroom_learning"],
  play: ["play and create", "play_and_making"], transport: ["use transport safely", "travel_and_transport"],
  location: ["find and describe places", "places_and_directions"], weather: ["talk about weather and clothing", "weather_and_clothing"],
  time: ["talk about time and routine", "time_and_routine"], technology: ["use everyday technology safely", "everyday_technology"],
  shopping: ["use money in simple shopping situations", "shopping_and_money"]
};
const rubric = {
  1: {rationale:"Tiny, self-contained language for immediate recognition and imitation. One thought, no subordinate clause, and no hidden context needed.",prerequisites:[],cefr:"Pre-A1/A1",maxCsTokens:5,maxEnTokens:5,maxCsChars:40,maxEnChars:40},
  2: {rationale:"Short everyday language that combines familiar words with one useful grammar focus and enough context to infer meaning.",prerequisites:["recognize-level-1-words-and-formulas"],cefr:"A1",maxCsTokens:10,maxEnTokens:10,maxCsChars:80,maxEnChars:80}
};
function tokens(text){return text.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu)||[];}
function normalized(text){return text.toLocaleLowerCase("cs-CZ").normalize("NFC");}
function normalizedSentence(text){return tokens(text).map(normalized).join(" ");}
function recordFromRow(row,index){
  const [difficulty,topic,cs,en,target,focus,explicitType]=row; const csTokens=tokens(cs);
  const targetIndex=csTokens.findIndex((token)=>normalized(token)===normalized(target));
  if(targetIndex<0)throw new Error("Target "+target+" missing from: "+cs);
  const sentenceType=explicitType||(cs.endsWith("?")?"question":"statement"); const level=rubric[difficulty];
  const [objective,topicTag]=topicMeta[topic]; const serial=String(index+1).padStart(4,"0");
  return {schemaVersion:"caatuu-word-world-record-v1",id:"ww-codex-exp-0001-"+serial,languages:{en:{text:en,alternates:[]},cs:{text:cs}},difficulty,cefr:level.cefr,topic,
    targets:[{surface:csTokens[targetIndex],normalized:normalized(csTokens[targetIndex]),tokenIndex:targetIndex,playable:true}],
    learning:{objective,skillFocus:[focus.replaceAll("_"," "),"word in meaningful context"],ageBand:"6-10",progression:{level:difficulty,rationale:level.rationale,prerequisites:level.prerequisites},support:{translationAvailable:true,imageSuitable:true,audioSuitable:true,dictionarySuitable:true}},
    grammar:{tags:["codex_authored","topic_"+topicTag,focus],sentenceType,clauseCount:1},scene:{query:en.replace(/[.!?]$/u,""),assetIds:[]},
    provenance:{sourceName:"Caatuu Word World Codex expansion",sourceIds:["codex-expansion-0001-"+serial],sourceLicense:"Caatuu-authored candidate; licensing confirmation required before promotion",sourceType:"codex_authored",transformation:"Original bilingual authoring for Caatuu; no external corpus text used. Metadata and exact target positions were generated from the authored pair."},
    review:{status:"candidate",reviewer:"candidate author self-check only",reviewedOn:"2026-07-21",humanApproved:false,checks:["author structural self-check","author bilingual self-check","author difficulty self-check"],notes:["Author self-check is not acceptance. This record awaits independent bilingual review."]}};
}

const records=rows.map(recordFromRow);
const canonical=fs.readFileSync(canonicalPath,"utf8").trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const coverage=JSON.parse(fs.readFileSync(coveragePath,"utf8"));
const coreDictionary=JSON.parse(fs.readFileSync(coreDictionaryPath,"utf8"));
const coreDictionaryTokens=new Set(coreDictionary.flatMap((entry)=>[...tokens(entry.cs||""),...tokens(entry.use||"")].map(normalized)));
const coverageByTarget=new Map(coverage.targets.perTarget.map((entry)=>[normalized(entry.normalized),entry]));
const errors=[]; const warnings=[]; const idSet=new Set(); const csSet=new Set(); const enSet=new Set();
for(const record of records){const level=rubric[record.difficulty];const csTokens=tokens(record.languages.cs.text);const enTokens=tokens(record.languages.en.text);
  if(idSet.has(record.id))errors.push("duplicate candidate id: "+record.id);idSet.add(record.id);
  const csKey=normalizedSentence(record.languages.cs.text);const enKey=normalizedSentence(record.languages.en.text);
  if(csSet.has(csKey))errors.push("duplicate candidate Czech: "+record.languages.cs.text);if(enSet.has(enKey))errors.push("duplicate candidate English: "+record.languages.en.text);csSet.add(csKey);enSet.add(enKey);
  if(csTokens.length>level.maxCsTokens)errors.push(record.id+" exceeds Czech token cap");if(enTokens.length>level.maxEnTokens)errors.push(record.id+" exceeds English token cap");
  if(record.languages.cs.text.length>level.maxCsChars)errors.push(record.id+" exceeds Czech character cap");if(record.languages.en.text.length>level.maxEnChars)errors.push(record.id+" exceeds English character cap");
  for(const target of record.targets){if(csTokens[target.tokenIndex]!==target.surface)errors.push(record.id+" has an inexact target position");}}
const canonicalCs=new Set(canonical.map((record)=>normalizedSentence(record.languages.cs.text)));const canonicalEn=new Set(canonical.map((record)=>normalizedSentence(record.languages.en.text)));
const exactCanonicalCzech=records.filter((record)=>canonicalCs.has(normalizedSentence(record.languages.cs.text))).map((record)=>record.id);
const exactCanonicalEnglish=records.filter((record)=>canonicalEn.has(normalizedSentence(record.languages.en.text))).map((record)=>record.id);
if(exactCanonicalCzech.length)errors.push("exact Czech duplicates against canonical: "+exactCanonicalCzech.join(", "));
function jaccard(a,b){const aa=new Set(tokens(a).map(normalized));const bb=new Set(tokens(b).map(normalized));const intersection=[...aa].filter((token)=>bb.has(token)).length;return intersection/new Set([...aa,...bb]).size;}
const highSimilarityPairs=[];for(let a=0;a<records.length;a+=1){for(let b=a+1;b<records.length;b+=1){const csA=records[a].languages.cs.text;const csB=records[b].languages.cs.text;if(Math.min(tokens(csA).length,tokens(csB).length)>=4){const similarity=jaccard(csA,csB);if(similarity>=0.8)highSimilarityPairs.push({ids:[records[a].id,records[b].id],similarity:Number(similarity.toFixed(3))});}}}
if(highSimilarityPairs.length)warnings.push("High token-overlap pairs require independent review.");
const byDifficulty=Object.groupBy(records,(record)=>String(record.difficulty));const byTopic=Object.groupBy(records,(record)=>record.topic);const bySentenceType=Object.groupBy(records,(record)=>record.grammar.sentenceType);
const candidateTargetCounts=new Map();for(const record of records){for(const target of record.targets.filter((entry)=>entry.playable)){candidateTargetCounts.set(target.normalized,(candidateTargetCounts.get(target.normalized)||0)+1);}}
const targetDelta=[...candidateTargetCounts].map(([target,added])=>{const prior=coverageByTarget.get(target);const before=prior?.recordCount||0;return {target,before,added,projected:before+added,inCoreDictionary:coreDictionaryTokens.has(target),priorTopics:prior?.topics||[]};}).sort((a,b)=>a.before-b.before||a.target.localeCompare(b.target,"cs"));
const openingCounts=new Map();for(const record of records){const opening=normalized(tokens(record.languages.cs.text)[0]||"");openingCounts.set(opening,(openingCounts.get(opening)||0)+1);}
const topCzechOpenings=[...openingCounts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"cs")).slice(0,12).map(([opening,count])=>({opening,count}));
const report={schemaVersion:"caatuu-word-world-candidate-authoring-report-v1",batchId:"codex-expansion-0001",createdOn:"2026-07-21",disposition:"candidate_only_pending_independent_review",selfReviewIsAcceptance:false,
  counts:{records:records.length,byDifficulty:Object.fromEntries(Object.entries(byDifficulty).map(([key,value])=>[key,value.length])),level2Share:Number(((byDifficulty["2"]?.length||0)/records.length).toFixed(4)),byTopic:Object.fromEntries(Object.entries(byTopic).map(([key,value])=>[key,value.length])),bySentenceType:Object.fromEntries(Object.entries(bySentenceType).map(([key,value])=>[key,value.length]))},
  targetCoverage:{distinctTargets:candidateTargetCounts.size,singletonTargetsBefore:targetDelta.filter((entry)=>entry.before===1).length,nonStrongTargetsBefore:targetDelta.filter((entry)=>entry.before>0&&entry.before<5).length,absentTargetsBefore:targetDelta.filter((entry)=>entry.before===0).length,alreadyStrongTargetsBefore:targetDelta.filter((entry)=>entry.before>=5).length,coreDictionaryTokenMatches:targetDelta.filter((entry)=>entry.inCoreDictionary).length,projectedNewBranchableTargets:targetDelta.filter((entry)=>entry.before===1&&entry.projected>=2).length,projectedNewStrongTargets:targetDelta.filter((entry)=>entry.before<5&&entry.projected>=5).length,perTarget:targetDelta},
  duplicateScan:{candidateExactCzech:0,candidateExactEnglish:0,canonicalExactCzech:exactCanonicalCzech,canonicalExactEnglish:exactCanonicalEnglish,highSimilarityCandidatePairs:highSimilarityPairs},diversity:{topCzechOpenings},
  selfCheck:{passed:errors.length===0,errors,warnings,checks:["record ids unique within batch","Czech and English exact duplicates absent within batch","Czech exact duplicates absent against current canonical pilot","difficulty token and character limits","target surface and token position exactness","weak-target coverage projection","high token-overlap pair scan","speaker gender and hidden-context author pass"]},
  reviewRequired:["independent Czech-English naturalness and semantic-equivalence review","independent difficulty and guided-learning review","license confirmation for first-party candidate data","promotion decision per record; rejected records must not enter source/"]};
const recordsText=records.map((record)=>JSON.stringify(record)).join("\n")+"\n";
const manifest={schemaVersion:"caatuu-word-world-candidate-manifest-v1",batchId:"codex-expansion-0001",createdOn:"2026-07-21",recordsFile:path.basename(outputPath),recordsSha256:crypto.createHash("sha256").update(recordsText).digest("hex"),authoringReport:path.basename(reportPath),generatorFile:path.basename(import.meta.filename),recordCount:records.length,difficultyIntent:{level1:"very simple review",level2:"main learning volume",level3:"not included in this batch"},status:"candidate",acceptedIntoCanonicalSource:false,compiledIntoRuntimePack:false,externalCorpusTextUsed:false,sourceName:"Caatuu Word World Codex expansion",sourceType:"codex_authored",licenseDisposition:"pending project confirmation before promotion",reviewDisposition:"author self-check complete; independent review required",intendedUse:"Add second or later meaningful contexts for weak Word World branch targets while preserving a guided Level 1/Level 2 progression."};
fs.mkdirSync(batchDir,{recursive:true});fs.writeFileSync(outputPath,recordsText,"utf8");fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n","utf8");fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n","utf8");
if(errors.length){console.error(JSON.stringify(report.selfCheck,null,2));process.exitCode=1;}else{console.log("Wrote "+records.length+" candidate records.");console.log("Level 1: "+byDifficulty["1"].length+"; Level 2: "+byDifficulty["2"].length+".");console.log("Projected new branchable targets: "+report.targetCoverage.projectedNewBranchableTargets+".");}
