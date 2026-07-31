from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete
from sqlmodel import Session, select

from ai_world_cup.schemas import Match, Standing, Team


@dataclass
class TeamStanding:
    group_name: str
    team_name: str
    played: int = 0
    won: int = 0
    draw: int = 0
    lost: int = 0
    goals_for: int = 0
    goals_against: int = 0
    points: int = 0

    @property
    def goal_difference(self) -> int:
        return self.goals_for - self.goals_against


def _group_stage_matches(session: Session) -> list[Match]:
    matches = list(
        session.exec(
            select(Match)
            .where(
                Match.group_name.is_not(None),
                Match.home_score.is_not(None),
                Match.away_score.is_not(None),
            )
            .order_by(Match.group_name, Match.match_number)
        )
    )
    return [
        match
        for match in matches
        if match.stage is None or "group" in match.stage.strip().lower()
    ]


def _team_for_name(session: Session, name: str, group_name: str) -> Team:
    team = session.exec(select(Team).where(Team.name == name)).first()
    if team:
        team.group_name = team.group_name or group_name
        session.add(team)
        session.flush()
        return team
    team = Team(name=name, country=name, group_name=group_name)
    session.add(team)
    session.flush()
    return team


def _apply_match(
    standings: dict[tuple[str, str], TeamStanding],
    group_name: str,
    home_team: str,
    away_team: str,
    home_score: int,
    away_score: int,
) -> None:
    home = standings.setdefault((group_name, home_team), TeamStanding(group_name, home_team))
    away = standings.setdefault((group_name, away_team), TeamStanding(group_name, away_team))

    home.played += 1
    away.played += 1
    home.goals_for += home_score
    home.goals_against += away_score
    away.goals_for += away_score
    away.goals_against += home_score

    if home_score > away_score:
        home.won += 1
        home.points += 3
        away.lost += 1
    elif away_score > home_score:
        away.won += 1
        away.points += 3
        home.lost += 1
    else:
        home.draw += 1
        away.draw += 1
        home.points += 1
        away.points += 1


def recalculate_group_standings(session: Session) -> int:
    """Rebuild actual group standings from completed group-stage matches."""
    standings: dict[tuple[str, str], TeamStanding] = {}
    for match in _group_stage_matches(session):
        if match.group_name is None or match.home_score is None or match.away_score is None:
            continue
        _apply_match(
            standings,
            match.group_name,
            match.home_team_name,
            match.away_team_name,
            match.home_score,
            match.away_score,
        )

    session.exec(delete(Standing))
    rows_written = 0
    by_group: dict[str, list[TeamStanding]] = {}
    for row in standings.values():
        by_group.setdefault(row.group_name, []).append(row)

    for group_name, group_rows in by_group.items():
        ranked_rows = sorted(
            group_rows,
            key=lambda row: (-row.points, -row.goal_difference, -row.goals_for, row.team_name),
        )
        for rank, row in enumerate(ranked_rows, start=1):
            team = _team_for_name(session, row.team_name, group_name)
            session.add(
                Standing(
                    group_name=group_name,
                    team_id=team.id,
                    played=row.played,
                    won=row.won,
                    draw=row.draw,
                    lost=row.lost,
                    goals_for=row.goals_for,
                    goals_against=row.goals_against,
                    goal_difference=row.goal_difference,
                    points=row.points,
                    rank=rank,
                )
            )
            rows_written += 1

    session.commit()
    return rows_written
