

def test_codes_with_no_ending_are_a_place_to_name():
    """03-11-00-00 has no ending: not "no place" but the project's own place, named by the office."""
    from app.domain.places import NO_ENDING, find_places, place_key

    assert place_key("03-11-00-00") == NO_ENDING
    assert place_key("03-11-00-00-05") == NO_ENDING  # a finer number, still no place ending
    assert place_key("03-11-00-00-P") == "P" and place_key("rain") is None and place_key(None) is None
    places = find_places(["03-11-00-00", "03-11-00-00-P", "05-12-00-00"], [], {NO_ENDING: "Main building"})
    none = next(p for p in places if p.suffix == NO_ENDING)
    assert (none.name, none.codes, none.example) == ("Main building", 2, "03-11-00-00")


def test_blank_cells_in_the_activity_list_do_not_break_the_places():
    """A cell with only spaces in Labour Detail's activity list (seen on an office PC: the place
    names page failed with "'NoneType' object has no attribute 'split'")."""
    from app.domain.places import find_places, place_key, place_suffix, work_part

    assert place_suffix("  ") is None and place_key("  ") is None and work_part("  ") == ""
    places = find_places(["03-11-00-00-P", None, 5, "", "  ", "#N/A"], [], {})
    assert [p.suffix for p in places] == ["P"]
