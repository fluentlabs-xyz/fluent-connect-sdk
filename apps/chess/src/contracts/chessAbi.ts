import { parseAbi } from "viem";
  
export const chessAbi = parseAbi([
  "event GameCreated(uint256 indexed gameId,address indexed white,address indexed black)",
  "event MoveSubmitted(uint256 indexed gameId,uint256 indexed moveNumber,address indexed player,address operator,string moveUci,string fenAfterMove)",
  "event OperatorApprovalChanged(uint256 indexed gameId,address indexed player,address indexed operator,bool approved)",
  "function createGame(address blackPlayer) returns (uint256 gameId)",
  "function approveOperator(uint256 gameId,address operator,bool approved)",
  "function submitMove(uint256 gameId,string moveUci,string fenAfterMove)",
  "function submitMoveFor(uint256 gameId,address player,string moveUci,string fenAfterMove)",
  "function games(uint256 gameId) view returns (address white,address black,address turn,bool active,uint64 moveCount,uint8 result)",
  "function nextGameId() view returns (uint256)",
  "function approvedOperators(uint256 gameId,address player,address operator) view returns (bool)",
]);

export const CHESS_SUBMIT_MOVE_SELECTOR = "0xe04f1d81" as const;
