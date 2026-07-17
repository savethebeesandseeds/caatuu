#!/usr/bin/env python3
"""Create a small supervised fine-tuning dataset for Caatuu Czech."""

from __future__ import annotations

import argparse
import json
import random
import re
import unicodedata
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2] / "data" / "models"
DATA_ROOT = ROOT.parent
APP_DATA = DATA_ROOT
CORPUS_SENTENCES = DATA_ROOT / "corpus" / "processed" / "czech_seed_sentences.txt"
OUT_DIR = ROOT / "czech-finetuned" / "training-data"

SYSTEM_CORRECT = (
    "Jsi český korektor pro začátečníky. Oprav pravopis a diakritiku. "
    "Neměň význam. Vrať pouze opravený český text."
)
SYSTEM_TRANSLATE = (
    "Jsi pomocník Caatuu Czech. Přelož krátký význam do přirozené češtiny. "
    "Vrať pouze český výraz nebo větu."
)
SYSTEM_EXPLAIN = (
    "Jsi trpělivý učitel češtiny pro začátečníky. Odpovídej česky, krátce a prakticky."
)
SYSTEM_DIALOGUE = (
    "Jsi pomocník Caatuu Czech. Piš přirozené krátké české dialogy pro začátečníky. "
    "Používej jen češtinu."
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def strip_diacritics(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def clean_sentence(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text


def has_czech_diacritic(text: str) -> bool:
    return any(ch in text for ch in "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ")


def make_example(system: str, user: str, assistant: str, source: str) -> dict[str, Any]:
    return {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
            {"role": "assistant", "content": assistant},
        ],
        "source": source,
    }


def correction_examples(sentences: list[str], *, limit: int) -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    candidates = [
        clean_sentence(sentence)
        for sentence in sentences
        if 25 <= len(sentence) <= 170 and has_czech_diacritic(sentence)
    ]
    for sentence in candidates[:limit]:
        plain = strip_diacritics(sentence)
        if plain != sentence:
            examples.append(
                make_example(
                    SYSTEM_CORRECT,
                    f"Oprav: {plain}",
                    sentence,
                    "corpus_diacritic_restore",
                )
            )
    return examples


def app_data_examples() -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    dictionary = load_json(APP_DATA / "dictionary.json")
    scripts = load_json(APP_DATA / "scripts.json")
    verbs = load_json(APP_DATA / "verbs.json")

    for item in dictionary:
        cs = item.get("cs")
        en = item.get("en")
        use = item.get("use")
        cue = item.get("cue")
        if cs and en:
            examples.append(make_example(SYSTEM_TRANSLATE, f"Přelož do češtiny: {en}", cs, "dictionary_translate"))
            examples.append(make_example(SYSTEM_TRANSLATE, f"Jak se česky řekne: {en}?", cs, "dictionary_translate_variant"))
            examples.append(make_example(SYSTEM_TRANSLATE, f"Vrať jen český překlad: {en}", cs, "dictionary_translate_variant"))
        if use and cs:
            examples.append(
                make_example(
                    SYSTEM_EXPLAIN,
                    f"Ukaž krátký příklad s výrazem „{cs}“.",
                    use,
                    "dictionary_usage",
                )
            )
            examples.append(
                make_example(
                    SYSTEM_EXPLAIN,
                    f"Napiš jednu krátkou českou větu se slovem „{cs}“.",
                    use,
                    "dictionary_usage_variant",
                )
            )
        if cs and cue:
            examples.append(
                make_example(
                    SYSTEM_EXPLAIN,
                    f"Jak se použije české slovo „{cs}“? Odpověz jednou krátkou větou.",
                    f"{cs}: {cue}.",
                    "dictionary_cue",
                )
            )

    for script in scripts:
        lines = [line for line in script.get("lines", []) if line.get("cs")]
        if not lines:
            continue
        dialogue = "\n".join(line["cs"] for line in lines)
        title = script.get("title", "situace")
        goal = script.get("goal", "")
        examples.append(
            make_example(
                SYSTEM_DIALOGUE,
                f"Napiš krátký český skript pro situaci: {title}. Cíl: {goal}.",
                dialogue,
                "script_dialogue",
            )
        )
        examples.append(
            make_example(
                SYSTEM_DIALOGUE,
                f"Napiš čtyři krátké repliky česky pro situaci „{title}“.",
                dialogue,
                "script_dialogue_variant",
            )
        )
        for line in lines:
            en = line.get("en")
            cs = line.get("cs")
            if en and cs:
                examples.append(make_example(SYSTEM_TRANSLATE, f"Přelož do češtiny: {en}", cs, "script_translate"))

    for verb in verbs:
        infinitive = verb.get("infinitive")
        english = verb.get("english")
        pattern = verb.get("pattern")
        if infinitive and english:
            examples.append(make_example(SYSTEM_TRANSLATE, f"Přelož sloveso do češtiny: {english}", infinitive, "verb_translate"))
        if infinitive and pattern:
            examples.append(
                make_example(
                    SYSTEM_EXPLAIN,
                    f"Dej krátkou pomůcku pro české sloveso „{infinitive}“.",
                    f"{infinitive}: {pattern}.",
                    "verb_pattern",
                )
            )
        for person, form in verb.get("forms", {}).items():
            cs = form.get("cs")
            en = form.get("en")
            if cs and en:
                examples.append(make_example(SYSTEM_TRANSLATE, f"Přelož do češtiny: {en}", cs, "verb_form"))
                examples.append(make_example(SYSTEM_TRANSLATE, f"Vrať pouze český slovesný tvar: {en}", cs, "verb_form_variant"))
                examples.append(make_example(SYSTEM_TRANSLATE, f"Jaký je český tvar pro „{en}“?", cs, "verb_form_variant"))
    return examples


def phrase_translation_examples() -> list[dict[str, Any]]:
    pairs = [
        ("Where is the station?", "Kde je nádraží?"),
        ("Where is the shop?", "Kde je obchod?"),
        ("Where is the toilet?", "Kde je toaleta?"),
        ("Where is the platform?", "Kde je nástupiště?"),
        ("Where is the bus stop?", "Kde je zastávka autobusu?"),
        ("I do not understand.", "Nerozumím."),
        ("I do not speak Czech.", "Nemluvím česky."),
        ("Please speak slowly.", "Mluvte prosím pomalu."),
        ("Can you repeat that?", "Můžete to zopakovat?"),
        ("Can I pay by card?", "Mohu platit kartou?"),
        ("Can I buy a ticket here?", "Mohu si tady koupit jízdenku?"),
        ("I would like two coffees.", "Chtěl bych dvě kávy."),
        ("I would like one coffee.", "Chtěl bych jednu kávu."),
        ("I would like water.", "Chtěl bych vodu."),
        ("The bill, please.", "Účet, prosím."),
        ("A ticket to Prague, please.", "Jízdenku do Prahy, prosím."),
        ("A ticket to Brno, please.", "Jízdenku do Brna, prosím."),
        ("Is the train delayed?", "Má vlak zpoždění?"),
        ("Today it is cold and raining.", "Dnes je zima a prší."),
        ("It is raining today.", "Dnes prší."),
        ("I am going to the shop.", "Jdu do obchodu."),
        ("I am at the station.", "Jsem na nádraží."),
        ("I am in the shop.", "Jsem v obchodě."),
        ("I need help.", "Potřebuji pomoc."),
        ("I need a doctor.", "Potřebuji lékaře."),
        ("I need a charger.", "Potřebuji nabíječku."),
        ("What is the password?", "Jaké je heslo?"),
        ("Do you have wifi?", "Máte wifi?"),
        ("I have a reservation.", "Mám rezervaci."),
        ("Here is my passport.", "Tady je pas."),
        ("I will send the document by email.", "Pošlu dokument e-mailem."),
        ("I am calling the police.", "Volám policii."),
        ("Call an ambulance.", "Zavolejte sanitku."),
        ("I am allergic.", "Mám alergii."),
        ("My head hurts.", "Bolí mě hlava."),
        ("How much does it cost?", "Kolik to stojí?"),
        ("That is too expensive.", "To je moc drahé."),
        ("I need a receipt.", "Potřebuji účtenku."),
        ("One moment, please.", "Moment, prosím."),
        ("Thank you very much.", "Moc děkuji."),
        ("Good morning.", "Dobré ráno."),
        ("Good evening.", "Dobrý večer."),
        ("Goodbye.", "Na shledanou."),
        ("Hi.", "Ahoj."),
    ]
    examples: list[dict[str, Any]] = []
    for en, cs in pairs:
        examples.append(make_example(SYSTEM_TRANSLATE, f"Přelož do češtiny. Vrať pouze větu: {en}", cs, "practical_phrase_translate"))
        examples.append(make_example(SYSTEM_TRANSLATE, f"Napiš česky pouze větu: {en}", cs, "practical_phrase_generate"))
    return examples


def case_usage_examples() -> list[dict[str, Any]]:
    rows = [
        ("I am going to the shop.", "Jdu do obchodu."),
        ("I am going to the station.", "Jdu na nádraží."),
        ("I am going to the pharmacy.", "Jdu do lékárny."),
        ("I am going to the hotel.", "Jdu do hotelu."),
        ("I am going to Prague.", "Jedu do Prahy."),
        ("I am going to Brno.", "Jedu do Brna."),
        ("I am in the shop.", "Jsem v obchodě."),
        ("I am at the station.", "Jsem na nádraží."),
        ("I am at the hotel.", "Jsem v hotelu."),
        ("I am at home.", "Jsem doma."),
        ("I am without a ticket.", "Jsem bez jízdenky."),
        ("Coffee without sugar, please.", "Kávu bez cukru, prosím."),
        ("Coffee with milk, please.", "Kávu s mlékem, prosím."),
        ("I would like two coffees.", "Chtěl bych dvě kávy."),
        ("I would like three rolls.", "Chtěl bych tři rohlíky."),
        ("I need a receipt.", "Potřebuji účtenku."),
        ("I need the bill.", "Potřebuji účet."),
        ("I need a ticket.", "Potřebuji jízdenku."),
        ("I am waiting for the train.", "Čekám na vlak."),
        ("I am waiting for the bus.", "Čekám na autobus."),
        ("I am speaking with the doctor.", "Mluvím s lékařem."),
        ("I am speaking with the seller.", "Mluvím s prodavačem."),
        ("I am paying by card.", "Platím kartou."),
        ("I am paying in cash.", "Platím hotově."),
    ]
    examples: list[dict[str, Any]] = []
    for en, cs in rows:
        examples.append(make_example(SYSTEM_TRANSLATE, f"Napiš česky pouze větu: {en}", cs, "case_usage_translate"))
        examples.append(make_example(SYSTEM_TRANSLATE, f"Přelož do češtiny. Vrať pouze větu: {en}", cs, "case_usage_translate"))
    return examples


def controlled_generation_examples() -> list[dict[str, Any]]:
    rows = [
        (
            "Napiš česky krátký seznam přesně tří pozdravů. Bez vysvětlení.",
            "Ahoj.\nDobrý den.\nDobrý večer.",
        ),
        (
            "Napiš přesně tři české pozdravy. Bez vysvětlení.",
            "Ahoj.\nDobré ráno.\nDobrý den.",
        ),
        (
            "Napiš česky tři krátké způsoby, jak říct ahoj.",
            "Ahoj.\nDobrý den.\nNazdar.",
        ),
        (
            "Vysvětli česky ve dvou krátkých větách rozdíl mezi „prosím“ a „děkuji“.",
            "Prosím říkáme, když o něco žádáme. Děkuji říkáme, když za něco děkujeme.",
        ),
        (
            "Napiš česky čtyři krátké repliky v obchodě. Použij slova: rohlíky, mléko, účet, prosím, děkuji.",
            "Zákazník: Dobrý den, tři rohlíky a mléko, prosím.\nProdavač: Tady to máte.\nZákazník: Účet, prosím.\nProdavač: Děkuji a na shledanou.",
        ),
        (
            "Napiš česky čtyři krátké repliky na nádraží.",
            "Cestující: Jízdenku do Brna, prosím.\nPokladní: Jednosměrnou, nebo zpáteční?\nCestující: Jednosměrnou.\nPokladní: Tady je jízdenka.",
        ),
        (
            "Napiš česky čtyři krátké repliky v kavárně.",
            "Host: Dobrý den, kávu a vodu, prosím.\nČíšník: Hned to bude.\nHost: Účet, prosím.\nČíšník: Platíte kartou?",
        ),
        (
            "Napiš česky čtyři krátké repliky v hotelu.",
            "Host: Dobrý den, mám rezervaci.\nRecepční: Vaše jméno, prosím?\nHost: Tady je pas.\nRecepční: Pokoj je ve druhém patře.",
        ),
    ]
    return [make_example(SYSTEM_DIALOGUE, user, assistant, "controlled_generation") for user, assistant in rows]


def dialogue_examples() -> list[dict[str, Any]]:
    scenarios = [
        (
            "obchod s potravinami",
            "Zákazník: Dobrý den, tři rohlíky, prosím.\nProdavač: Ještě něco?\nZákazník: Ano, mléko a sýr.\nProdavač: To bude devadesát korun.\nZákazník: Platím kartou.\nProdavač: Děkuji.",
        ),
        (
            "nákup lístku",
            "Cestující: Dobrý den, jízdenku do Prahy, prosím.\nPokladní: Na dnešek?\nCestující: Ano, na dnešek.\nPokladní: Vlak jede z nástupiště dva.\nCestující: Děkuji.\nPokladní: Na shledanou.",
        ),
        (
            "ptaní na cestu",
            "Turista: Promiňte, kde je nádraží?\nMístní: Jděte rovně a potom doleva.\nTurista: Je to daleko?\nMístní: Ne, asi pět minut.\nTurista: Děkuji.\nMístní: Prosím.",
        ),
        (
            "lékárna",
            "Zákazník: Dobrý den, bolí mě hlava.\nLékárník: Máte alergii?\nZákazník: Ne, nemám.\nLékárník: Tady je lék.\nZákazník: Děkuji.\nLékárník: Prosím.",
        ),
        (
            "telefon a internet",
            "Host: Dobrý den, máte wifi?\nPracovník: Ano, máme.\nHost: Jaké je heslo?\nPracovník: Heslo je na účtence.\nHost: Potřebuji také nabíječku.\nPracovník: Tady je.",
        ),
        (
            "restaurace",
            "Host: Dobrý večer, máte volný stůl?\nČíšník: Ano, pro kolik osob?\nHost: Pro dvě osoby.\nČíšník: Tady je jídelní lístek.\nHost: Děkuji.\nČíšník: Prosím.",
        ),
        (
            "hotel",
            "Host: Dobrý den, mám rezervaci.\nRecepční: Jak se jmenujete?\nHost: Jmenuji se Daniel.\nRecepční: Tady je klíč.\nHost: Kde je pokoj?\nRecepční: Ve druhém patře.",
        ),
        (
            "nouzová pomoc",
            "Osoba: Potřebuji pomoc.\nOperátor: Co se stalo?\nOsoba: Mám úraz.\nOperátor: Kde jste?\nOsoba: Jsem na nádraží.\nOperátor: Sanitka jede.",
        ),
    ]
    examples: list[dict[str, Any]] = []
    for title, dialogue in scenarios:
        examples.append(make_example(SYSTEM_DIALOGUE, f"Napiš krátký český dialog pro situaci: {title}.", dialogue, "practical_dialogue"))
        examples.append(make_example(SYSTEM_DIALOGUE, f"Napiš šest jednoduchých replik česky: {title}.", dialogue, "practical_dialogue"))
    return examples


def shop_request_examples() -> list[dict[str, Any]]:
    items = [
        ("one coffee", "jednu kávu"),
        ("two coffees", "dvě kávy"),
        ("three coffees", "tři kávy"),
        ("one roll", "jeden rohlík"),
        ("two rolls", "dva rohlíky"),
        ("three rolls", "tři rohlíky"),
        ("one water", "jednu vodu"),
        ("two waters", "dvě vody"),
        ("one ticket", "jednu jízdenku"),
        ("two tickets", "dvě jízdenky"),
        ("one beer", "jedno pivo"),
        ("two beers", "dvě piva"),
        ("one bread", "jeden chléb"),
        ("one milk", "jedno mléko"),
        ("two milks", "dvě mléka"),
    ]
    examples: list[dict[str, Any]] = []
    for en, cs_item in items:
        sentence = f"Chtěl bych {cs_item}, prosím."
        examples.append(make_example(SYSTEM_TRANSLATE, f"Napiš česky pouze větu: I would like {en}, please.", sentence, "shop_request"))
        examples.append(make_example(SYSTEM_TRANSLATE, f"Přelož do češtiny. Vrať pouze větu: I would like {en}, please.", sentence, "shop_request"))
        examples.append(make_example(SYSTEM_TRANSLATE, f"Jak řeknu v obchodě: {en}, please?", sentence, "shop_request"))
    return examples


def generated_case_pattern_examples() -> list[dict[str, Any]]:
    places = [
        ("the shop", "do obchodu", "v obchodě"),
        ("the supermarket", "do supermarketu", "v supermarketu"),
        ("the station", "na nádraží", "na nádraží"),
        ("the platform", "na nástupiště", "na nástupišti"),
        ("the hotel", "do hotelu", "v hotelu"),
        ("the pharmacy", "do lékárny", "v lékárně"),
        ("the restaurant", "do restaurace", "v restauraci"),
        ("the cafe", "do kavárny", "v kavárně"),
        ("the office", "do kanceláře", "v kanceláři"),
        ("the city center", "do centra", "v centru"),
        ("Prague", "do Prahy", "v Praze"),
        ("Brno", "do Brna", "v Brně"),
    ]
    examples: list[dict[str, Any]] = []
    for en, goal, location in places:
        go_sentence = f"Jdu {goal}."
        be_sentence = f"Jsem {location}."
        examples.append(make_example(SYSTEM_TRANSLATE, f"Napiš česky pouze větu: I am going to {en}.", go_sentence, "case_pattern"))
        examples.append(make_example(SYSTEM_TRANSLATE, f"Přelož do češtiny. Vrať pouze větu: I am going to {en}.", go_sentence, "case_pattern"))
        examples.append(make_example(SYSTEM_TRANSLATE, f"Napiš česky pouze větu: I am at {en}.", be_sentence, "case_pattern"))
        examples.append(make_example(SYSTEM_TRANSLATE, f"Přelož do češtiny. Vrať pouze větu: I am at {en}.", be_sentence, "case_pattern"))
    return examples


def generated_dialogue_examples() -> list[dict[str, Any]]:
    cafe_orders = [
        ("kávu", "Kávu, prosím."),
        ("čaj", "Čaj, prosím."),
        ("vodu", "Vodu, prosím."),
        ("kávu a vodu", "Kávu a vodu, prosím."),
        ("dvě kávy", "Dvě kávy, prosím."),
        ("účet", "Účet, prosím."),
    ]
    station_destinations = ["Prahy", "Brna", "Ostravy", "Plzně", "Olomouce"]
    directions = [
        ("toaleta", "Toaleta je rovně a potom vlevo."),
        ("nádraží", "Nádraží je rovně a potom doprava."),
        ("metro", "Metro je za rohem."),
        ("hotel", "Hotel je naproti kavárně."),
        ("lékárna", "Lékárna je vedle obchodu."),
    ]
    examples: list[dict[str, Any]] = []

    for item, request in cafe_orders:
        dialogue = f"Host: Dobrý den, {request}\nČíšník: Hned to bude.\nHost: Děkuji.\nČíšník: Prosím."
        examples.append(make_example(SYSTEM_DIALOGUE, f"Napiš čtyři krátké repliky v kavárně s výrazem „{item}“.", dialogue, "generated_dialogue"))

    for destination in station_destinations:
        dialogue = (
            f"Cestující: Jízdenku do {destination}, prosím.\n"
            "Pokladní: Jednosměrnou, nebo zpáteční?\n"
            "Cestující: Jednosměrnou, prosím.\n"
            "Pokladní: Tady je jízdenka."
        )
        examples.append(make_example(SYSTEM_DIALOGUE, f"Napiš čtyři krátké repliky na nádraží pro cestu do {destination}.", dialogue, "generated_dialogue"))

    for place, answer in directions:
        dialogue = f"Turista: Promiňte, kde je {place}?\nMístní: {answer}\nTurista: Je to daleko?\nMístní: Ne, je to blízko."
        examples.append(make_example(SYSTEM_DIALOGUE, f"Napiš krátký dialog o hledání místa: {place}.", dialogue, "generated_dialogue"))

    return examples


def fixed_examples() -> list[dict[str, Any]]:
    pairs = [
        (
            "Oprav: Dobry den, chtel bych dve kavy a jeden ucet prosim.",
            "Dobrý den, chtěl bych dvě kávy a jeden účet, prosím.",
        ),
        ("Oprav: Prosim vas, kde je nadrazi?", "Prosím vás, kde je nádraží?"),
        ("Oprav: Mam rad ceskou kavu a cerstvy chleba.", "Mám rád českou kávu a čerstvý chléb."),
        ("Oprav: Vcera jsem koupil mleko v obchode.", "Včera jsem koupil mléko v obchodě."),
    ]
    examples = [make_example(SYSTEM_CORRECT, user, assistant, "fixed_eval_like_correction") for user, assistant in pairs]
    examples.extend(phrase_translation_examples())
    examples.extend(case_usage_examples())
    examples.extend(controlled_generation_examples())
    examples.extend(dialogue_examples())
    examples.extend(shop_request_examples())
    examples.extend(generated_case_pattern_examples())
    examples.extend(generated_dialogue_examples())
    examples.extend(
        [
            make_example(
                SYSTEM_DIALOGUE,
                "Napiš čtyři krátké repliky v obchodě se slovy: rohlíky, mléko, účet, prosím, děkuji.",
                "Zákazník: Dobrý den, dva rohlíky a jedno mléko, prosím.\nProdavač: Tady to máte.\nZákazník: Účet, prosím.\nProdavač: Samozřejmě. Děkuji.",
                "fixed_shop_dialogue",
            ),
            make_example(
                SYSTEM_EXPLAIN,
                "Vysvětli jednoduše rozdíl mezi „prosím“ a „děkuji“.",
                "„Prosím“ říkáme, když o něco žádáme. „Děkuji“ říkáme, když za něco děkujeme.",
                "fixed_explanation",
            ),
        ]
    )
    return examples


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--correction-limit", type=int, default=1200)
    parser.add_argument("--val-size", type=int, default=80)
    args = parser.parse_args()

    random.seed(args.seed)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sentences = CORPUS_SENTENCES.read_text(encoding="utf-8").splitlines()
    random.shuffle(sentences)

    examples = []
    examples.extend(fixed_examples())
    examples.extend(app_data_examples())
    examples.extend(correction_examples(sentences, limit=args.correction_limit))

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for example in examples:
        key = json.dumps(example["messages"], ensure_ascii=False, sort_keys=True)
        if key not in seen:
            seen.add(key)
            deduped.append(example)
    random.shuffle(deduped)

    val_size = min(args.val_size, max(20, len(deduped) // 10))
    val = deduped[:val_size]
    train = deduped[val_size:]

    for name, rows in [("train.jsonl", train), ("val.jsonl", val), ("all.jsonl", deduped)]:
        with (OUT_DIR / name).open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    summary = {
        "train_examples": len(train),
        "val_examples": len(val),
        "total_examples": len(deduped),
        "sources": sorted({row["source"] for row in deduped}),
        "source_counts": {
            source: sum(1 for row in deduped if row["source"] == source)
            for source in sorted({row["source"] for row in deduped})
        },
    }
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
