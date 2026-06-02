# 4-bit Relay CPU — Web Emulator

Small browser-based emulator that models a relay-built 4-bit accumulator CPU with 5 words of 4-bit memory, 4 2-bit registers, an ALU (ADD, MUL, SUB, NAND, XOR), and simple instructions: `MOV`, `MVI`, `CLR`, `LAR`, `RDT`, `WRB`.

Features:
- Mobile-friendly UI
- Relay click sounds using WebAudio
- Single-file download to export a standalone HTML

How to run
1. Open `index.html` in a browser (or serve the folder via a static server).
2. Use the program editor to write simple assembly, click `Assemble` then `Run` or `Step`.

Notes
- Registers `R0`..`R3` are 2-bit values (0–3). Memory is `M0`..`M4` (4-bit each).
- Example immediate format: `0xA` or decimal `10`.
