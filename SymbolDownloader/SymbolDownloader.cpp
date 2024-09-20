/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at htp://mozilla.org/MPL/2.0/. */
#include <windows.h>
#include <string>
#include <filesystem>
#include <stdio.h>
#include "dia/dia2.h"
#include "dia/diacreate.h"
#include "wil/com.h"

bool g_bPdbRetrieved = false;
std::wstring g_pdbPath;

std::filesystem::path g_exeDir;

std::wstring GetSymbolSearchPath(void)
{
	std::filesystem::path symbolPath = g_exeDir / "symbols";
	return L"srv*" + symbolPath.wstring() + L"*https://msdl.microsoft.com/download/symbols";
}

struct DiaLoadCallback : public IDiaLoadCallback2
{
	STDMETHODIMP QueryInterface(REFIID riid, void **ppvObject) override
	{
		if (riid == __uuidof(IUnknown) || riid == __uuidof(IDiaLoadCallback))
		{
			*ppvObject = static_cast<IDiaLoadCallback *>(this);
			return S_OK;
		}
		else if (riid == _uuidof(IDiaLoadCallback2))
		{
			*ppvObject = static_cast<IDiaLoadCallback2 *>(this);
			return S_OK;
		}
		return E_NOINTERFACE;
	}

	STDMETHODIMP_(ULONG) AddRef() override { return 2; /* On stack */ }
	STDMETHODIMP_(ULONG) Release() override { return 1; /* On stack */ }
	STDMETHODIMP NotifyDebugDir(BOOL fExecutable, DWORD cbData, BYTE *pbData) override { return S_OK; }
	STDMETHODIMP NotifyOpenDBG(LPCOLESTR dbgPath, HRESULT hr) override { return S_OK; }

	STDMETHODIMP NotifyOpenPDB(LPCOLESTR pdbPath, HRESULT hr) override
	{
		if (SUCCEEDED(hr))
		{
			g_bPdbRetrieved = true;
			g_pdbPath = pdbPath;
		}
		return S_OK;
	}

	// Only use explicitly-specified search paths; restrict all but symbol
	// server access:
	STDMETHODIMP RestrictRegistryAccess() override { return E_FAIL; }
	STDMETHODIMP RestrictSymbolServerAccess() override { return S_OK; }
	STDMETHODIMP RestrictOriginalPathAccess() override { return E_FAIL; }
	STDMETHODIMP RestrictReferencePathAccess() override { return E_FAIL; }
	STDMETHODIMP RestrictDBGAccess() override { return E_FAIL; }
	STDMETHODIMP RestrictSystemRootAccess() override { return E_FAIL; }
};

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nShowCmd)
{
	std::wstring modulePath;
	int argc = 0;
	LPWSTR *argv = CommandLineToArgvW(lpCmdLine, &argc);
	if (argc <= 0 || !argv || !argv[0] || !argv[0][0])
	{
		MessageBoxW(NULL, L"Usage: SymbolDownloader.exe <path>", L"SymbolDownloader", MB_ICONINFORMATION);
		return 1;
	}
	
	modulePath = argv[0];
	LocalFree(argv);
		
	// Get directory of the EXE.
	WCHAR szPath[MAX_PATH];
	GetModuleFileNameW(hInstance, szPath, MAX_PATH);
	g_exeDir = szPath;
	g_exeDir = g_exeDir.parent_path();

	// Load DIA.
	std::filesystem::path msdiaPath = g_exeDir / L"msdia140.dll";
	wil::com_ptr<IDiaDataSource> diaSource;
	if (FAILED(NoRegCoCreate(
		msdiaPath.c_str(),
		CLSID_DiaSource,
		IID_PPV_ARGS(diaSource.put())
	)))
	{
		MessageBoxW(NULL, L"Failed to create DIA source.", L"SymbolDownloader", MB_ICONERROR);
		return 1;
	}

	// Load the symbols.
	DiaLoadCallback cb;
	if (FAILED(diaSource->loadDataForExe(
		modulePath.c_str(),
		GetSymbolSearchPath().c_str(),
		&cb
	)))
	{
		MessageBoxW(NULL, L"Failed to load symbol data.", L"SymbolDownloader", MB_ICONERROR);
		return 1;
	};

	while (!g_bPdbRetrieved)
	{
		Sleep(1);
	}

	// Write the PDB path into a text file so the Node script can access it.
	std::filesystem::path pdbPathPath = g_exeDir.parent_path() / L"current_pdb.txt";
	DeleteFile(pdbPathPath.c_str());
	HANDLE hFile = CreateFileW(
		pdbPathPath.c_str(),
		FILE_GENERIC_WRITE,
		0,
		nullptr,
		CREATE_ALWAYS,
		FILE_ATTRIBUTE_NORMAL,
		NULL
	);
	if (!hFile)
	{
		MessageBoxW(NULL, L"Failed to create PDB path file.", L"SymbolDownloader", MB_ICONERROR);
		return 1;
	}

	// Convert to UTF-8, then write.
	std::string pdbPath(g_pdbPath.begin(), g_pdbPath.end());
	if (!WriteFile(
		hFile,
		(LPCVOID)pdbPath.c_str(),
		pdbPath.size(),
		nullptr,
		nullptr
	))
	{
		MessageBoxW(NULL, L"Failed to write to PDB path file.", L"SymbolDownloader", MB_ICONERROR);
		return 1;
	}

	return 0;
}