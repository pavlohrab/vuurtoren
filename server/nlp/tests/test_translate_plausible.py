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
