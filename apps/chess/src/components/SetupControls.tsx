import type { ChessBotLevel, ChessPermissionSession, ChessPlayMode } from "./types";

export function SetupControls({
  botConfig,
  canCreateGame,
  creatingNewGame,
  draftBatchPublishing,
  draftBotLevel,
  draftPlayMode,
  gameOngoing,
  gamePaused,
  permissionSession,
  setupBusy,
  onCancelNewGame,
  onCopyBotConfig,
  onDraftBatchPublishingChange,
  onDraftBotLevelChange,
  onDraftPlayModeChange,
  onOpenNewGameSetup,
  onPauseChange,
  onRunGasRouteDemo,
  onStartAutoPlay,
  onSubmitNewGame,
}: {
  botConfig: string;
  canCreateGame: boolean;
  creatingNewGame: boolean;
  draftBatchPublishing: boolean;
  draftBotLevel: ChessBotLevel;
  draftPlayMode: ChessPlayMode;
  gameOngoing: boolean;
  gamePaused: boolean;
  permissionSession: ChessPermissionSession | null;
  setupBusy: boolean;
  onCancelNewGame: () => void;
  onCopyBotConfig: () => void;
  onDraftBatchPublishingChange: (value: boolean) => void;
  onDraftBotLevelChange: (value: ChessBotLevel) => void;
  onDraftPlayModeChange: (value: ChessPlayMode) => void;
  onOpenNewGameSetup: () => void;
  onPauseChange: (paused: boolean) => void | Promise<void>;
  onRunGasRouteDemo: () => void;
  onStartAutoPlay: () => void;
  onSubmitNewGame: () => void;
}) {
  return (
    <div className="chess-setup-flow">
      {!creatingNewGame ? (
        <button
          className="chess-primary-action"
          type="button"
          onClick={onOpenNewGameSetup}
          disabled={!canCreateGame || setupBusy}
        >
          New Game
        </button>
      ) : (
        <div className="chess-new-game-config">
          <div className={`chess-bot-level chess-bot-level-${draftBotLevel}`}>
            <span>Select bot level</span>
            <div className="chess-level-options" role="radiogroup" aria-label="Select bot level">
              {(["easy", "medium", "hard"] as const).map((level) => (
                <button
                  aria-checked={draftBotLevel === level}
                  className={draftBotLevel === level ? "active" : ""}
                  key={level}
                  onClick={() => onDraftBotLevelChange(level)}
                  role="radio"
                  type="button"
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          <div className="chess-mode-row">
            <button
              className={draftPlayMode === "manual" ? "active" : ""}
              onClick={() => onDraftPlayModeChange("manual")}
              disabled={setupBusy}
              type="button"
            >
              Play yourself
            </button>
            <button
              className={draftPlayMode === "bot" ? "active" : ""}
              onClick={() => onDraftPlayModeChange("bot")}
              disabled={setupBusy}
              type="button"
            >
              Auto play
            </button>
          </div>
          <div className="chess-mode-row">
            <button
              className={draftBatchPublishing ? "active" : ""}
              onClick={() => onDraftBatchPublishingChange(true)}
              disabled={setupBusy}
              type="button"
            >
              Batch approve + move
            </button>
            <button
              className={!draftBatchPublishing ? "active" : ""}
              onClick={() => onDraftBatchPublishingChange(false)}
              disabled={setupBusy}
              type="button"
            >
              Single tx
            </button>
          </div>
          <div className="chess-mode-row">
            <button
              className="active"
              type="button"
              onClick={onSubmitNewGame}
              disabled={!canCreateGame || setupBusy}
            >
              {setupBusy ? "Creating" : "Create Game"}
            </button>
            <button type="button" onClick={onCancelNewGame} disabled={setupBusy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <button type="button" onClick={onRunGasRouteDemo} disabled={setupBusy}>
        Test gas route
      </button>
      {gameOngoing ? (
        <button
          className="chess-primary-action"
          type="button"
          onClick={onStartAutoPlay}
          disabled={setupBusy}
        >
          Start Auto Play
        </button>
      ) : null}
      {gameOngoing ? (
        <button
          className={gamePaused ? "chess-resume-button" : "chess-pause-button"}
          type="button"
          onClick={() => onPauseChange(!gamePaused)}
          disabled={setupBusy}
        >
          {gamePaused ? "Resume Game" : "Pause Game"}
        </button>
      ) : null}
      {permissionSession ? (
        <button type="button" onClick={onCopyBotConfig} disabled={setupBusy}>
          Copy bot config
        </button>
      ) : null}
      {botConfig ? (
        <textarea
          aria-label="Bot config export"
          data-testid="bot-config-export"
          readOnly
          style={{ left: "-10000px", position: "absolute" }}
          value={botConfig}
        />
      ) : null}
    </div>
  );
}
