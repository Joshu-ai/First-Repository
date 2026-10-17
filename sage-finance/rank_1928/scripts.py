"""Daikoku · Bitcoin Watch: Strategy's Oct 2026 buy. Facts from Strategy's 8-K filed Oct 5, 2026 (via StockTitan / The Block):
334 BTC for $28.7M at avg $85,838.8 (Oct 1-4); holdings 848,000 BTC; aggregate cost $63.97B; avg cost $75,440.7/BTC;
funded by $15.7M net MSTR share sales + $13.0M USD cash. BTC ~ $86,083 (The Block, Oct 5) -> value ~ $73.0B, paper gain ~ $9.0B.
848,000 / 21,000,000 = 4.04% of the supply cap.
Lines: (text, pause). {DISPLAY|spoken words} shows DISPLAY on screen and speaks the words (no hyphens, for alignment)."""
SHORTS = {
    "rank_1928": {
        "title": "$100 invested in 1928, ranked",
        "credit": "1928–2025 · Damodaran (NYU), BLS · Not financial advice",
        "lines": [
            ("{$100|A hundred dollars} in stocks in {1928|nineteen twenty eight} became {$1.16 million|one point one six million} by {2025.|twenty twenty five}", 0.25),
            ("Corporate bonds: {$54,000.|fifty four thousand}", 0.10),
            ("Gold: {$21,000.|twenty one thousand}", 0.10),
            ("Treasury bonds: over {$7,700.|seventy seven hundred}", 0.10),
            ("Home prices: {$5,600.|fifty six hundred}", 0.10),
            ("Treasury bills: {$2,600.|twenty six hundred}", 0.25),
            ("Cash in a drawer? Still {$100,|a hundred dollars} buying what {$5|five dollars} did then.", 0.30),
            ("But stocks lost {44%|forty four percent} in {1931.|nineteen thirty one}", 0.30),
            ("Would you have held on, or sold...", 0.20),
            ("before {$100|a hundred dollars} became {$1.16 million?|one point one six million}", 0.0),
        ],
    },
    "strat_oct": {
        "title": "Strategy buys more Bitcoin",
        "credit": "Source: Strategy 8-K, Oct 5 · Not financial advice",
        "lines": [
            ("One company now owns over {4%|four percent} of all the Bitcoin that will ever exist.", 0.30),
            ("Strategy just bought {334|three hundred thirty four} more, for {$28.7M.|twenty eight point seven million dollars}", 0.30),
            ("That's {848,000|eight hundred forty eight thousand} Bitcoin, at about {$75,400|seventy five thousand four hundred dollars} each.", 0.30),
            ("Right now, that's about {$9B|nine billion dollars} in paper gains.", 0.30),
            ("But if Bitcoin falls below its average cost, those gains turn to losses.", 0.35),
            ("So... smart bet, or reckless...", 0.20),
            ("when one company owns over {4%|four percent} of all the Bitcoin that will ever exist?", 0.0),
        ],
    },
    "week_oct5": {
        "title": "This week in money",
        "credit": "Oct 5–9 · Sources: Fed, Freddie Mac · Not financial advice",
        "lines": [
            ("Mortgage rates just jumped to {7.28%.|seven point two eight percent}", 0.30),
            ("Here are three dates to watch this week.", 0.30),
            ("Wednesday at {2 PM|two p m} Eastern, the Fed releases the minutes from September's rate hike.", 0.25),
            ("They could hint whether another hike is coming.", 0.30),
            ("Thursday at noon, Freddie Mac posts the new mortgage rate.", 0.30),
            ("And PepsiCo and Delta report earnings, a read on grocery and airfare prices.", 0.35),
            ("So... higher, or lower...", 0.20),
            ("where do mortgage rates go after jumping to {7.28%?|seven point two eight percent}", 0.0),
        ],
    },
}
VOICE = "am_michael"
SPEED = 1.05
LEAD_IN = 0.10
TAIL = 0.40
