import pytest

from vuurtoren_nlp.cleanup import (
    clean_pages,
    clean_text,
    is_page_number,
    join_lines,
    normalize_text,
    reflow_paragraph,
    remove_running_lines,
)


def test_normalize_ligatures_quotes_whitespace() -> None:
    raw = "e\ufb03cient \u201cquote\u201d it\u2019s\u00a0ok \u00ad\u200b  fine\t\tx \ufb01n"
    assert normalize_text(raw) == 'efficient "quote" it\'s ok fine x fin'


@pytest.mark.parametrize(
    ("prev", "nxt", "expected"),
    [
        ("woor-", "den en zinnen", "woorden en zinnen"),  # break hyphen
        ("Noord-", "Amerika is groot", "Noord-Amerika is groot"),  # capitalised compound
        ("land-", "en tuinbouw", "land- en tuinbouw"),  # suspended hyphen
        ("zin", "vervolg", "zin vervolg"),  # plain wrap
        ("e-", "mail", "email"),  # unavoidable ambiguity, documented
        ("- ", "iets", "- iets"),  # lone dash is not a hyphenation
    ],
)
def test_join_lines(prev: str, nxt: str, expected: str) -> None:
    assert join_lines(prev, nxt) == expected


def test_hyphen_not_at_line_end_is_kept() -> None:
    assert reflow_paragraph("Hij woonde in Noord-Holland en\nwerkte er.") == (
        "Hij woonde in Noord-Holland en werkte er."
    )


def test_reflow_keeps_midline_hyphens_and_merges() -> None:
    text = "De Noord-Hollandse kust is lang\nen mooi in de zomer."
    assert reflow_paragraph(text) == "De Noord-Hollandse kust is lang en mooi in de zomer."


def test_reflow_splits_short_sentence_ending_line() -> None:
    block = (
        "Dit is een lange regel die bijna de volle breedte van de kolom beslaat en meer.\n"
        "Kort einde.\n"
        "Een nieuwe alinea begint hier met een hoofdletter en loopt door."
    )
    out = reflow_paragraph(block)
    assert out.split("\n\n") == [
        "Dit is een lange regel die bijna de volle breedte van de kolom beslaat en meer. "
        "Kort einde.",
        "Een nieuwe alinea begint hier met een hoofdletter en loopt door.",
    ]


@pytest.mark.parametrize(
    "line", ["12", " 7 ", "- 12 -", "Pagina 3", "blz. 14", "iv", "XII", "3 / 10", "p. 5"]
)
def test_page_numbers_detected(line: str) -> None:
    assert is_page_number(line)


@pytest.mark.parametrize("line", ["", "lid", "mix", "Hoofdstuk 1", "2019 was goed", "12 appels"])
def test_non_page_numbers(line: str) -> None:
    assert not is_page_number(line)


def test_running_headers_footers_removed_across_pages() -> None:
    bodies = ["alpha one\nbeta two\ngamma", "delta\nepsilon\nzeta eta", "theta\niota\nkappa"]
    pages = [
        f"Tijdschrift voor Taal {n}\n{body}\n{n}\nJournal 2019"
        for n, body in enumerate(bodies, start=1)
    ]
    assert remove_running_lines(pages) == bodies


def test_unique_edge_lines_survive() -> None:
    pages = ["Titel van dit stuk\nTekst een.\n1", "Andere kop\nTekst twee.\n2"]
    out = remove_running_lines(pages)
    assert out[0].startswith("Titel van dit stuk")  # not repeated -> kept
    assert out[1].startswith("Andere kop")
    assert not out[0].endswith("1")  # bare page number removed


def test_clean_pages_full_pipeline() -> None:
    pages = [
        "Kop\n\nHet was een lange dag en de her-\nfst kwam eraan. Zij liep naar Noord-\n"
        "Holland en woonde daar.\n\nTweede alinea loopt door\n1",
        "Kop\n\nvoort in de volgende pagina.\n\nNog een alinea.\n2",
    ]
    out = clean_pages(pages)
    assert out == (
        "Het was een lange dag en de herfst kwam eraan. Zij liep naar Noord-Holland "
        "en woonde daar.\n\nTweede alinea loopt door voort in de volgende pagina."
        "\n\nNog een alinea."
    )


def test_clean_text_form_feed_pages_and_empty() -> None:
    assert clean_text("") == ""
    assert clean_text("een\n\ntwee") == "een\n\ntwee"
    assert clean_text("een\n\n\n\ntwee.\x0cdrie") == "een\n\ntwee.\n\ndrie"


def test_reflow_keeps_a_heading_without_a_blank_line_apart() -> None:
    block = (
        "De trein naar Amsterdam\n"
        "Elke maandag neem ik de trein naar Amsterdam. De reis duurt\n"
        "ongeveer een uur. Ik lees een boek of ik kijk naar buiten.\n"
        "Hoofdstuk twee\n"
        "In de trein zitten veel studenten. Ze praten, lachen en drinken koffie."
    )
    assert reflow_paragraph(block).split("\n\n") == [
        "De trein naar Amsterdam",
        "Elke maandag neem ik de trein naar Amsterdam. De reis duurt ongeveer een uur. "
        "Ik lees een boek of ik kijk naar buiten.",
        "Hoofdstuk twee",
        "In de trein zitten veel studenten. Ze praten, lachen en drinken koffie.",
    ]


def test_reflow_does_not_take_a_wrapped_name_for_a_heading() -> None:
    block = (
        "Elke maandag neem ik de trein naar het station van\n"
        "Amsterdam Centraal en daarna loop ik naar mijn werk aan de gracht."
    )
    assert "\n\n" not in reflow_paragraph(block)
