# Winbindex Symbols
This script downloads modules and symbols from Winbindex, and sorts them into
a CSV file by PDB size, descending.

## How to use
1. Build the SymbolDownloader project in Visual Studio 2022.
2. Get a copy of msdia140.dll and symsrv.dll with the same architecture as SymbolDownloader.exe
   and place them in `bin`.
3. Run `node index.js <module name>`.