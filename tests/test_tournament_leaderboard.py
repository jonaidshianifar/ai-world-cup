from __future__ import annotations

from ai_world_cup.evaluation.tournament import build_tournament_leaderboard
from ai_world_cup.schemas import (
    LLMModel,
    Match,
    PredictedFinalRanking,
    PredictedGroupStanding,
    Standing,
    Team,
    TournamentManualResponse,
    TournamentPrediction,
)


def test_tournament_leaderboard_scores_group_stage(session) -> None:
    model = LLMModel(model_display_name="Model A", provider="Provider")
    match = Match(
        match_number=1,
        stage="Group Stage",
        group_name="A",
        home_team_name="Mexico",
        away_team_name="South Africa",
        home_score=2,
        away_score=1,
    )
    session.add(model)
    session.add(match)
    session.commit()
    session.refresh(model)
    manual = TournamentManualResponse(
        tournament_prompt_run_id=1,
        model_id=model.id,
        response_file_path="response.json",
        raw_response_text="{}",
        parse_status="VALID",
    )
    session.add(manual)
    session.commit()
    session.refresh(manual)
    session.add(
        TournamentPrediction(
            tournament_manual_response_id=manual.id,
            model_id=model.id,
            match_number=1,
            stage="Group Stage",
            group_name="A",
            home_team="Mexico",
            away_team="South Africa",
            predicted_home_goals=2,
            predicted_away_goals=1,
            predicted_outcome="HOME_WIN",
            predicted_winner="Mexico",
            confidence=0.7,
            reasoning_short="Home edge.",
            is_official_fixture=True,
        )
    )
    session.add(
        PredictedFinalRanking(
            tournament_manual_response_id=manual.id,
            model_id=model.id,
            champion="Mexico",
            runner_up="France",
            third_place="Argentina",
            fourth_place="Brazil",
        )
    )
    session.commit()
    rows = build_tournament_leaderboard(session)
    assert rows[0].total_tournament_points == 11
    assert rows[0].champion_prediction == "Mexico"
    assert rows[0].exact_score_accuracy == 1.0


def test_tournament_leaderboard_scores_group_standings(session) -> None:
    model = LLMModel(model_display_name="Model A", provider="Provider")
    session.add(model)
    session.commit()
    session.refresh(model)
    manual = TournamentManualResponse(
        tournament_prompt_run_id=1,
        model_id=model.id,
        response_file_path="response.json",
        raw_response_text="{}",
        parse_status="VALID",
    )
    session.add(manual)
    session.commit()
    session.refresh(manual)

    teams = []
    for name in ["Uruguay", "France", "Mexico", "South Africa"]:
        team = Team(name=name, country=name, group_name="A")
        session.add(team)
        teams.append(team)
    session.commit()
    for team in teams:
        session.refresh(team)

    for rank, team in enumerate(teams, start=1):
        session.add(Standing(group_name="A", team_id=team.id, rank=rank))
        session.add(
            PredictedGroupStanding(
                tournament_manual_response_id=manual.id,
                model_id=model.id,
                group_name="A",
                rank=rank,
                team=team.name,
                points=0,
                goals_for=0,
                goals_against=0,
                goal_difference=0,
            )
        )
    session.commit()

    rows = build_tournament_leaderboard(session)

    assert rows[0].group_standing_points == 27
    assert rows[0].total_tournament_points == 27
