# Fluent Chess Blitz Demo Brief

This demo shows Fluent Connect as an SDK layer that lets a builder app onboard a user, create a Fluent smart account, and delegate narrowly scoped actions without exposing wallet complexity.

The user starts by connecting with Fluent. Under the hood, Fluent Connect uses the user's Privy embedded signer to prepare a ZeroDev smart account on Fluent Testnet. The app displays the Fluent account as the primary account and keeps the embedded signer hidden.

In the chess demo, the user creates a new on-chain game from the Fluent smart account. The game contract charges 1 BLEND per move. After the game is created, the user approves bounded BLEND spend and grants a scoped ZeroDev session that can only call the chess `submitMove` method from the user's Fluent account.

Once the session is registered, the bot can play the white side through the user's ZeroDev permission account. The black side is played by the bot's own wallet. Every move is a real Fluent Testnet transaction and emits an on-chain event that updates the board in near real time.

What to show:

1. Open the chess app and connect with Fluent.
2. Start a new game with Auto play enabled.
3. Point out that the user does not connect MetaMask or manage a second wallet.
4. Show that the board updates as transactions land.
5. Open the on-chain activity list and show separate white and black tx links.
6. Explain that white moves are delegated from the user's Fluent account, while black moves are submitted by the bot wallet.

Current live contract:

- Fluent Testnet chess contract: `0xA6ECe42bf2f1Df4FFA25578E8ff4097dD5AEBB3b`
- BLEND token: `0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E`
- Bot wallet: `0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E`

Important caveat:

The demo now uses ZeroDev permission sessions for delegated white moves. The remaining production work is a proper permission center with revoke/expiry UX, persisted bot sessions, and policy telemetry.
