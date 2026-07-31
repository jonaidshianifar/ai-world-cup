from __future__ import annotations

from sqlmodel import select

from ai_world_cup.data.standings import recalculate_group_standings
from ai_world_cup.schemas import Match, Standing, Team


def test_recalculate_group_standings_from_completed_matches(session) -> None:
    session.add_all(
        [
            Match(
                match_number=1,
                stage="Group Stage",
                group_name="A",
                home_team_name="Mexico",
                away_team_name="South Africa",
                home_score=2,
                away_score=0,
            ),
            Match(
                match_number=2,
                stage="Group Stage",
                group_name="A",
                home_team_name="Uruguay",
                away_team_name="France",
                home_score=1,
                away_score=0,
            ),
            Match(
                match_number=3,
                stage="Group Stage",
                group_name="A",
                home_team_name="France",
                away_team_name="Mexico",
                home_score=3,
                away_score=1,
            ),
            Match(
                match_number=4,
                stage="Group Stage",
                group_name="A",
                home_team_name="Uruguay",
                away_team_name="South Africa",
                home_score=2,
                away_score=2,
            ),
            Match(
                match_number=5,
                stage="Final",
                group_name="FINAL",
                home_team_name="Uruguay",
                away_team_name="France",
                home_score=1,
                away_score=0,
            ),
        ]
    )
    session.commit()

    assert recalculate_group_standings(session) == 4

    teams = {team.id: team.name for team in session.exec(select(Team))}
    rows = list(session.exec(select(Standing).order_by(Standing.rank)))

    assert [(row.rank, teams[row.team_id], row.points, row.goal_difference) for row in rows] == [
        (1, "Uruguay", 4, 1),
        (2, "France", 3, 1),
        (3, "Mexico", 3, 0),
        (4, "South Africa", 1, -2),
    ]
