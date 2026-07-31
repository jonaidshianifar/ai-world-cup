from __future__ import annotations

import json

from sqlmodel import Session, select

from ai_world_cup.data.normalize import normalize_openfootball, normalize_worldcup26, parse_datetime
from ai_world_cup.data.standings import recalculate_group_standings
from ai_world_cup.data.validation import NormalizedMatch, NormalizedStadium, NormalizedTeam
from ai_world_cup.schemas import DataSnapshot, Match, Stadium, Team


def _source_json(source_name: str, source_id: str | None) -> str:
    return json.dumps({source_name: source_id}, sort_keys=True)


def upsert_team(session: Session, team: NormalizedTeam) -> Team:
    existing = session.exec(select(Team).where(Team.name == team.name)).first()
    if existing:
        existing.fifa_code = team.fifa_code or existing.fifa_code
        existing.country = team.country or existing.country
        existing.group_name = team.group_name or existing.group_name
        existing.logo_url = team.logo_url or existing.logo_url
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing
    db_team = Team(
        source_ids_json=_source_json(team.source_name, team.source_id),
        name=team.name,
        fifa_code=team.fifa_code,
        country=team.country,
        group_name=team.group_name,
        logo_url=team.logo_url,
    )
    session.add(db_team)
    session.commit()
    session.refresh(db_team)
    return db_team


def upsert_stadium(session: Session, stadium: NormalizedStadium) -> Stadium:
    existing = session.exec(select(Stadium).where(Stadium.name == stadium.name)).first()
    if existing:
        return existing
    db_stadium = Stadium(
        source_ids_json=_source_json(stadium.source_name, stadium.source_id),
        name=stadium.name,
        city=stadium.city,
        country=stadium.country,
        capacity=stadium.capacity,
        latitude=stadium.latitude,
        longitude=stadium.longitude,
    )
    session.add(db_stadium)
    session.commit()
    session.refresh(db_stadium)
    return db_stadium


def upsert_match(session: Session, match: NormalizedMatch, snapshot: DataSnapshot) -> Match:
    existing = None
    if match.source_id:
        existing = session.exec(
            select(Match).where(
                Match.source_ids_json == _source_json(match.source_name, match.source_id)
            )
        ).first()
    if existing is None and match.match_number is not None:
        existing = session.exec(
            select(Match).where(Match.match_number == match.match_number)
        ).first()
    home = upsert_team(
        session,
        NormalizedTeam(
            source_name=match.source_name, source_id=match.home_team_name, name=match.home_team_name
        ),
    )
    away = upsert_team(
        session,
        NormalizedTeam(
            source_name=match.source_name, source_id=match.away_team_name, name=match.away_team_name
        ),
    )
    values = {
        "source_ids_json": _source_json(match.source_name, match.source_id),
        "match_number": match.match_number,
        "stage": match.stage,
        "group_name": match.group_name,
        "home_team_id": home.id,
        "away_team_id": away.id,
        "home_team_name": match.home_team_name,
        "away_team_name": match.away_team_name,
        "kickoff_utc": parse_datetime(match.kickoff_utc),
        "venue_name": match.venue_name,
        "status": match.status,
        "home_score": match.home_score,
        "away_score": match.away_score,
        "raw_json": json.dumps(match.raw, sort_keys=True, default=str),
        "data_snapshot_id": snapshot.id,
    }
    if existing:
        for key, value in values.items():
            setattr(existing, key, value)
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing
    db_match = Match(**values)
    session.add(db_match)
    session.commit()
    session.refresh(db_match)
    return db_match


def ingest_source_payload(
    session: Session, source_name: str, payload: dict, snapshot: DataSnapshot
) -> dict[str, int]:
    if source_name == "openfootball":
        teams, matches = normalize_openfootball(payload)
        stadiums: list[NormalizedStadium] = []
    elif source_name == "worldcup26":
        teams, stadiums, matches = normalize_worldcup26(payload)
    else:
        return {"teams": 0, "stadiums": 0, "matches": 0}
    for team in teams:
        upsert_team(session, team)
    for stadium in stadiums:
        upsert_stadium(session, stadium)
    for match in matches:
        upsert_match(session, match, snapshot)
    recalculate_group_standings(session)
    return {"teams": len(teams), "stadiums": len(stadiums), "matches": len(matches)}
