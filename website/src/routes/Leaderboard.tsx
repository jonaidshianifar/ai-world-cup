import { useEffect, useMemo, useState } from 'react';
import { ChartCard } from '../components/ChartCard';
import { LeaderboardTable } from '../components/LeaderboardTable';
import { ConfidenceChart } from '../charts/ConfidenceChart';
import { ExactScoreChart } from '../charts/ExactScoreChart';
import { LeaderboardBarChart } from '../charts/LeaderboardBarChart';
import { OutcomeAccuracyChart } from '../charts/OutcomeAccuracyChart';
import { api } from '../lib/api';
import type { LeaderboardRow, ModelInfo, TournamentGroupTable, TournamentView } from '../lib/types';
import { unique } from '../lib/utils';

type QualificationRow = {
  modelName: string;
  provider: string;
  predictedTeams: number;
  correctTeams: number;
  qualificationPoints: number;
  roundOf32ReachPoints: number;
  groupWinnerPoints: number;
  topTwoPoints: number;
  exactRankPoints: number;
  totalPhasePoints: number;
};

type KnockoutRoundScore = {
  stage: string;
  stagePoints: number;
  correctTeams: number;
  teamPoints: number;
  correctWinners: number;
  winnerPoints: number;
  totalPoints: number;
};

type KnockoutScoreRow = {
  modelName: string;
  provider: string;
  rounds: KnockoutRoundScore[];
  totalTeamPoints: number;
  totalWinnerPoints: number;
  totalKnockoutPoints: number;
};

const knockoutStagePoints: Record<string, number> = {
  'Round of 32': 2,
  'Round of 16': 4,
  'Quarter-final': 6,
  'Quarter-finals': 6,
  Quarterfinals: 6,
  'Semi-final': 8,
  'Semi-finals': 8,
  Semifinals: 8,
  Final: 12
};

function teamsInRound(view: TournamentView, stage: string): Set<string> {
  const round = view.knockout_rounds.find((item) => item.stage === stage);
  return new Set(round?.matches.flatMap((match) => [match.home_team, match.away_team]) ?? []);
}

function stagePoints(stage: string): number {
  return knockoutStagePoints[stage] ?? 0;
}

function matchWinner(match: TournamentView['knockout_rounds'][number]['matches'][number]): string | null {
  if (match.winner) return match.winner;
  if (match.home_score === null || match.away_score === null || match.home_score === match.away_score) {
    return null;
  }
  return match.home_score > match.away_score ? match.home_team : match.away_team;
}

function knockoutScores(views: TournamentView[]): KnockoutScoreRow[] {
  const actual = views.find((view) => view.source.kind === 'actual');
  if (!actual) return [];

  const actualMatches = new Map(
    actual.knockout_rounds.flatMap((round) =>
      round.matches
        .filter((match) => match.match_number !== null)
        .map((match) => [match.match_number, match] as const)
    )
  );

  return views
    .filter((view) => view.source.kind === 'model')
    .map((view) => {
      const rounds = view.knockout_rounds
        .map((round) => {
          const pointsPerHit = stagePoints(round.stage);
          let correctTeams = 0;
          let correctWinners = 0;

          round.matches.forEach((match) => {
            if (match.match_number === null) return;
            const actualMatch = actualMatches.get(match.match_number);
            if (!actualMatch) return;
            const actualTeams = new Set([actualMatch.home_team, actualMatch.away_team]);
            const predictedTeams = new Set([match.home_team, match.away_team]);
            predictedTeams.forEach((team) => {
              if (actualTeams.has(team)) correctTeams += 1;
            });
            const actualWinner = matchWinner(actualMatch);
            if (actualWinner && matchWinner(match) === actualWinner) {
              correctWinners += 1;
            }
          });

          const teamPoints = correctTeams * pointsPerHit;
          const winnerPoints = correctWinners * pointsPerHit;
          return {
            stage: round.stage,
            stagePoints: pointsPerHit,
            correctTeams,
            teamPoints,
            correctWinners,
            winnerPoints,
            totalPoints: teamPoints + winnerPoints
          };
        })
        .filter((round) => round.stagePoints > 0);

      return {
        modelName: view.source.label,
        provider: view.source.provider,
        rounds,
        totalTeamPoints: rounds.reduce((total, round) => total + round.teamPoints, 0),
        totalWinnerPoints: rounds.reduce((total, round) => total + round.winnerPoints, 0),
        totalKnockoutPoints: rounds.reduce((total, round) => total + round.totalPoints, 0)
      };
    })
    .sort((left, right) =>
      right.totalKnockoutPoints - left.totalKnockoutPoints ||
      right.totalWinnerPoints - left.totalWinnerPoints ||
      left.modelName.localeCompare(right.modelName)
    );
}

function groupTablesByName(view: TournamentView): Map<string, TournamentGroupTable> {
  return new Map(view.group_tables.map((table) => [table.group, table]));
}

function sameTeamSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((team) => rightSet.has(team));
}

function qualificationRows(views: TournamentView[]): QualificationRow[] {
  const actual = views.find((view) => view.source.kind === 'actual');
  if (!actual) return [];
  const actualRoundOf32Teams = teamsInRound(actual, 'Round of 32');
  const actualGroups = groupTablesByName(actual);

  return views
    .filter((view) => view.source.kind === 'model')
    .map((view) => {
      const predictedRoundOf32Teams = teamsInRound(view, 'Round of 32');
      const correctTeams = Array.from(predictedRoundOf32Teams).filter((teamName) =>
        actualRoundOf32Teams.has(teamName)
      ).length;
      const modelGroups = groupTablesByName(view);
      let groupWinnerPoints = 0;
      let topTwoPoints = 0;
      let exactRankPoints = 0;

      actualGroups.forEach((actualTable, groupName) => {
        const modelTable = modelGroups.get(groupName);
        if (!modelTable) return;
        const actualTeams = actualTable.rows.map((row) => row.team);
        const modelTeams = modelTable.rows.map((row) => row.team);
        if (actualTeams[0] && actualTeams[0] === modelTeams[0]) {
          groupWinnerPoints += 5;
        }
        if (sameTeamSet(actualTeams.slice(0, 2), modelTeams.slice(0, 2))) {
          topTwoPoints += 5;
        }
        actualTeams.forEach((teamName, index) => {
          if (modelTeams[index] === teamName) {
            exactRankPoints += 2;
          }
        });
      });

      const qualificationPoints = correctTeams * 3;
      return {
        modelName: view.source.label,
        provider: view.source.provider,
        predictedTeams: predictedRoundOf32Teams.size,
        correctTeams,
        qualificationPoints,
        roundOf32ReachPoints: correctTeams * 2,
        groupWinnerPoints,
        topTwoPoints,
        exactRankPoints,
        totalPhasePoints:
          groupWinnerPoints +
          topTwoPoints +
          qualificationPoints +
          exactRankPoints +
          correctTeams * 2,
      };
    })
    .sort((a, b) =>
      b.correctTeams - a.correctTeams ||
      b.totalPhasePoints - a.totalPhasePoints ||
      a.modelName.localeCompare(b.modelName)
    );
}

export function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tournamentViews, setTournamentViews] = useState<TournamentView[]>([]);
  const [provider, setProvider] = useState('');
  const [webSearch, setWebSearch] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    void Promise.all([api.leaderboard(), api.models(), api.tournamentViews()]).then(([leaderboardRows, modelRows, tournamentPayload]) => {
      setRows(leaderboardRows);
      setModels(modelRows);
      setTournamentViews(tournamentPayload.views);
    });
  }, []);

  const providers = unique(rows.map((row) => row.provider)).sort();
  const modelByName = new Map(models.map((model) => [model.model_display_name, model]));
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) => {
          const model = modelByName.get(row.model_name);
          const searchValue =
            model?.web_search_enabled === true
              ? 'enabled'
              : model?.web_search_enabled === false
                ? 'disabled'
                : 'unknown';
          return (
            (!provider || row.provider === provider) &&
            (!webSearch || searchValue === webSearch) &&
            (!query || row.model_name.toLowerCase().includes(query.toLowerCase()))
          );
        }
      ),
    [rows, provider, query, webSearch, modelByName]
  );
  const qualificationSummary = useMemo(
    () =>
      qualificationRows(tournamentViews).filter((row) =>
        (!provider || row.provider === provider) &&
        (!query || row.modelName.toLowerCase().includes(query.toLowerCase()))
      ),
    [provider, query, tournamentViews]
  );
  const knockoutSummary = useMemo(
    () =>
      knockoutScores(tournamentViews).filter((row) =>
        (!provider || row.provider === provider) &&
        (!query || row.modelName.toLowerCase().includes(query.toLowerCase()))
      ),
    [provider, query, tournamentViews]
  );
  const knockoutStages = useMemo(
    () =>
      Array.from(new Set(knockoutSummary.flatMap((row) => row.rounds.map((round) => round.stage)))),
    [knockoutSummary]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Tournament leaderboard</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">Sortable model rankings from exported tournament prediction data.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <input className="rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" placeholder="Search model" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" value={provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="">All providers</option>
          {providers.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" value={webSearch} onChange={(event) => setWebSearch(event.target.value)}>
          <option value="">All search settings</option>
          <option value="enabled">Web search enabled</option>
          <option value="disabled">Web search disabled</option>
          <option value="unknown">Web search unknown</option>
        </select>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Total points"><LeaderboardBarChart data={filtered} /></ChartCard>
        <ChartCard title="Outcome accuracy"><OutcomeAccuracyChart data={filtered} /></ChartCard>
        <ChartCard title="Exact score accuracy"><ExactScoreChart data={filtered} /></ChartCard>
        <ChartCard title="Average confidence"><ConfidenceChart data={filtered} /></ChartCard>
      </div>
      {qualificationSummary.length ? (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="border-b border-slate-100 p-4 dark:border-slate-800">
            <h2 className="text-xl font-semibold">Group stage to Round of 32</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Correct qualified teams are counted against the real Round of 32. Points follow the scoring rules for group winners, top two, qualified teams, exact ranks, and teams reaching the Round of 32.
            </p>
          </div>
          <div className="table-scroll">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <tr>
                  {['Model', 'Predicted R32', 'Correct R32', 'Qualified pts', 'R32 reach pts', 'Group winner pts', 'Top-two pts', 'Exact-rank pts', 'Phase total'].map((head) => (
                    <th key={head} className="px-4 py-3 font-semibold">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {qualificationSummary.map((row) => (
                  <tr key={row.modelName} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{row.modelName}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{row.provider}</div>
                    </td>
                    <td className="px-4 py-3">{row.predictedTeams}/32</td>
                    <td className="px-4 py-3 font-semibold">{row.correctTeams}/32</td>
                    <td className="px-4 py-3">{row.qualificationPoints}</td>
                    <td className="px-4 py-3">{row.roundOf32ReachPoints}</td>
                    <td className="px-4 py-3">{row.groupWinnerPoints}</td>
                    <td className="px-4 py-3">{row.topTwoPoints}</td>
                    <td className="px-4 py-3">{row.exactRankPoints}</td>
                    <td className="px-4 py-3 font-semibold">{row.totalPhasePoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {knockoutSummary.length ? (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="border-b border-slate-100 p-4 dark:border-slate-800">
            <h2 className="text-xl font-semibold">Knockout round scoring</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Each round awards its stage value for every correct team in the fixture and again for the correct match winner.
            </p>
          </div>
          <div className="table-scroll">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-semibold">Model</th>
                  {knockoutStages.map((stage) => (
                    <th key={stage} className="px-4 py-3 font-semibold">{stage}</th>
                  ))}
                  <th className="px-4 py-3 font-semibold">Team pts</th>
                  <th className="px-4 py-3 font-semibold">Winner pts</th>
                  <th className="px-4 py-3 font-semibold">Knockout total</th>
                </tr>
              </thead>
              <tbody>
                {knockoutSummary.map((row) => {
                  const roundsByStage = new Map(row.rounds.map((round) => [round.stage, round]));
                  return (
                    <tr key={row.modelName} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-4 py-3">
                        <div className="font-semibold">{row.modelName}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{row.provider}</div>
                      </td>
                      {knockoutStages.map((stage) => {
                        const round = roundsByStage.get(stage);
                        return (
                          <td key={stage} className="px-4 py-3">
                            {round ? (
                              <div className="space-y-1">
                                <div className="font-semibold">{round.totalPoints}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {round.correctTeams} teams, {round.correctWinners} winners
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3">{row.totalTeamPoints}</td>
                      <td className="px-4 py-3">{row.totalWinnerPoints}</td>
                      <td className="px-4 py-3 font-semibold">{row.totalKnockoutPoints}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <LeaderboardTable data={filtered} />
    </div>
  );
}
