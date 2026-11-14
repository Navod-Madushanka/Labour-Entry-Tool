

def test_codes_with_no_ending_are_a_place_to_name():
    """03-11-00-00 has no ending: not "no place" but the project's own place, named by the office."""
    from app.domain.places import NO_ENDING, find_places, place_key

    assert place_key("03-11-00-00") == NO_ENDING
    assert place_key("03-11-00-00-05") == NO_ENDING  # a finer number, still no place ending
    assert place_key("03-11-00-00-P") == "P" and place_key("rain") is None and place_key(None) is None
    places = find_places(["03-11-00-00", "03-11-00-00-P", "05-12-00-00"], [], {NO_ENDING: "Main building"})
    none = next(p for p in places if p.suffix == NO_ENDING)
    assert (none.name, none.codes, none.example) == ("Main building", 2, "03-11-00-00")
