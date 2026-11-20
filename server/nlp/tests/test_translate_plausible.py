from vuurtoren_nlp.translate import plausible


def test_accepts_real_translations() -> None:
    assert plausible("Wat een dag!", "What a day!")
    assert plausible("– Wat", "What's going on?")
    assert plausible("Hij woont in Amsterdam.", "He lives in Amsterdam.")


def test_rejects_dutch_output() -> None:
    assert not plausible("wat :", "– wisselt razendsnel en in extreme mate van stemming.")


def test_rejects_runaway_and_empty_output() -> None:
    assert not plausible("Ja.", "Yes. " * 20)
    assert not plausible("Ja.", "  ")


def test_rejects_a_repeated_sentence() -> None:
    assert not plausible("– wisselt razendsnel van stemming.", "Oh, my God. Oh, my God.")


def test_clean_source_keeps_every_position() -> None:
    from vuurtoren_nlp.translate import clean_source

    for text in ["– wisselt razendsnel.", "Hij zit – zegt ze – thuis.", "• Een punt", "Gewoon."]:
        assert len(clean_source(text)) == len(text)
    assert clean_source("– wisselt").lstrip() == "wisselt"
    assert clean_source("zit – hij heeft") == "zit , hij heeft"


def test_clean_output_drops_dot_padding() -> None:
    from vuurtoren_nlp.translate import clean_output

    assert clean_output("He lives together . . . . . . . .") == "He lives together."
    assert clean_output("Wait...") == "Wait..."
