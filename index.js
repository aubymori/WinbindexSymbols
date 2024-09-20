/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at htp://mozilla.org/MPL/2.0/. */
const pako = require("pako");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const MACHINE_TYPES = {
    IMAGE_FILE_MACHINE_AM33: 0x1d3,
    IMAGE_FILE_MACHINE_AMD64: 0x8664,
    IMAGE_FILE_MACHINE_ARM: 0x1c0,
    IMAGE_FILE_MACHINE_ARMV7: 0x1c4,
    IMAGE_FILE_MACHINE_EBC: 0xebc,
    IMAGE_FILE_MACHINE_I386: 0x14c,
    IMAGE_FILE_MACHINE_IA64: 0x200,
    IMAGE_FILE_MACHINE_M32R: 0x9041,
    IMAGE_FILE_MACHINE_MIPS16: 0x266,
    IMAGE_FILE_MACHINE_MIPSFPU: 0x366,
    IMAGE_FILE_MACHINE_MIPSFPU16: 0x466,
    IMAGE_FILE_MACHINE_POWERPC: 0x1f0,
    IMAGE_FILE_MACHINE_POWERPCFP: 0x1f1,
    IMAGE_FILE_MACHINE_R4000: 0x166,
    IMAGE_FILE_MACHINE_SH3: 0x1a2,
    IMAGE_FILE_MACHINE_SH3E: 0x01a4,
    IMAGE_FILE_MACHINE_SH3DSP: 0x1a3,
    IMAGE_FILE_MACHINE_SH4: 0x1a6,
    IMAGE_FILE_MACHINE_SH5: 0x1a8,
    IMAGE_FILE_MACHINE_THUMB: 0x1c2,
    IMAGE_FILE_MACHINE_WCEMIPSV2: 0x169,
    IMAGE_FILE_MACHINE_R3000: 0x162,
    IMAGE_FILE_MACHINE_R10000: 0x168,
    IMAGE_FILE_MACHINE_ALPHA: 0x184,
    IMAGE_FILE_MACHINE_ALPHA64: 0x0284,
    IMAGE_FILE_MACHINE_CEE: 0xC0EE,
    IMAGE_FILE_MACHINE_TRICORE: 0x0520,
    IMAGE_FILE_MACHINE_CEF: 0x0CEF,
};

function machineTypeToString(machineType)
{
    for (const name in MACHINE_TYPES)
    {
        if (MACHINE_TYPES[name] == machineType)
            return name;
    }
    return "Unknown machine type";
}

// Valid versions to grab from. By default, this is
// all Vibranium versions.
const VALID_WINDOWS_VERSIONS = [
    "2004",
    "20H2",
    "21H1",
    "21H2",
    "22H2"
];

// Valid PE machine types. By default, this is x86
// archiectures.
const VALID_MACHINE_TYPES = [
    MACHINE_TYPES.IMAGE_FILE_MACHINE_AMD64,
    MACHINE_TYPES.IMAGE_FILE_MACHINE_I386
];

function makeSymbolServerUrl(peName, timeStamp, imageSize)
{
    // "%s/%s/%08X%x/%s" % (serverName, peName, timeStamp, imageSize, peName)
    // https://randomascii.wordpress.com/2013/03/09/symbols-the-microsoft-way/

    var fileId = ("0000000" + timeStamp.toString(16).toUpperCase()).slice(-8) + imageSize.toString(16).toLowerCase();
    return "https://msdl.microsoft.com/download/symbols/" + peName + "/" + fileId + "/" + peName;
}

console.log("WinbindexSymbols");
console.log();

let moduleName = process.argv[2];
if (!moduleName)
{
    console.log("No module name specified");
    process.exit(1);
}

console.log(`Getting symbols for module ${moduleName}`);

(async function() {

let r = await fetch(`https://winbindex.m417z.com/data/by_filename_compressed/${moduleName}.json.gz`);
if (r.status != 200)
{
    console.log(`Fatal: Request to Winbindex failed with HTTP ${r.status}`);
    process.exit(1);
}

let unzipped = pako.ungzip(await r.bytes());
let json = JSON.parse(new TextDecoder().decode(unzipped));

/* Collect hashes to go through and download */
let hashes = [];
for (const hash in json)
{
    const obj = json[hash];
    let validFile = false;
    for (const ver of VALID_WINDOWS_VERSIONS)
    {
        if (obj.windowsVersions[ver])
        {
            for (const type of VALID_MACHINE_TYPES)
            {
                if (obj.fileInfo?.machineType == type)
                {
                    validFile = true;
                    break;
                }
            }
        }

        if (validFile)
            break;
    }

    if (validFile && obj.fileInfo?.timestamp && obj.fileInfo?.virtualSize)
        hashes.push(hash);
}

let files = [];
for (const hash of hashes)
{
    const obj = json[hash];
    // Get the actual module.
    let cachePath = `./cache/${moduleName}/${hash}/${moduleName}`;
    if (!fs.existsSync(cachePath))
    {
        const url = makeSymbolServerUrl(moduleName, obj.fileInfo.timestamp, obj.fileInfo.virtualSize);
        console.log(`Downloading ${moduleName} from URL ${url}...`);
        let r = await fetch(url);
        if (r.status == 200)
        {
            console.log("Successful");
            let dir = `./cache/${moduleName}/${hash}`;
            if (!fs.existsSync(dir))
            {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(cachePath, await r.bytes(), (e) => { if (e) console.error(e) });
        }
        else
        {
            console.log(`Failed with HTTP ${r.status}`);
        }
    }
    else
    {
        console.log(`Loading ${moduleName} (${hash}) from cache`);
    }

    // Don't overload the MS symbol server
    //await new Promise(r => setTimeout(r, 500));

    // Now, get the symbols.
    const absolutePath = path.resolve(cachePath);
    try
    { 
        execSync(`.\\bin\\SymbolDownloader.exe "${absolutePath}"`, {});
    }
    catch (e)
    {
        console.log(e);
        continue;
    }

    const pdbPath = fs.readFileSync("./current_pdb.txt", { encoding: "utf8" });
    if (!fs.existsSync(pdbPath))
    {
        console.log("Somehow, the PDB doesn't exist");
        continue;
    }
    let size = fs.statSync(pdbPath).size;
    console.log(`Size of PDB: ${size}`);

    files.push({
        modulePath: absolutePath,
        pdbPath: pdbPath,
        pdbSize: size,
        machineType: machineTypeToString(obj.fileInfo.machineType),
        version: obj.fileInfo.version
    });
}

// Sort files by PDB size descending
files.sort((a, b) => b.pdbSize - a.pdbSize);
console.log("Writing CSV...");

// Create CSV of the info
let csvText = "Module path,PDB path,PDB size,Machine type,Version\n";
for (const file of files)
{
    csvText += [
        file.modulePath,
        file.pdbPath,
        file.pdbSize,
        file.machineType,
        file.version
    ].join(",");
    csvText += "\n";
}

if (!fs.existsSync("./csvs"))
{
    fs.mkdirSync("./csvs");
}

fs.writeFileSync(`./csvs/${moduleName}.csv`, csvText, () => {});
console.log(`Written to csvs/${moduleName}.csv`);

})();