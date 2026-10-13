"""Build a local VSIX with only the allowlisted sources."""
from __future__ import annotations
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FILES = ("package.json", "extension.js", "protocol.cjs", "README.md", "test.cjs")

def main(out: Path) -> None:
    info = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert (info["name"], info["publisher"], info["version"]) == (
        "chatgpt-pc-staging-copilot", "livingos-local", "0.0.1"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    manifest = """<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Id="chatgpt-pc-staging-copilot" Version="0.0.1" Publisher="livingos-local" Language="en-US"/>
    <DisplayName>ChatGPT PC Staging Copilot Provider</DisplayName>
    <Description xml:space="preserve">Isolated local text-only model for Copilot verification</Description>
    <Categories>Other</Categories>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
  </Assets>
</PackageManifest>"""
    types = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="cjs" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>"""
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("extension.vsixmanifest", manifest)
        bundle.writestr("[Content_Types].xml", types)
        for name in FILES:
            bundle.write(ROOT / name, "extension/" + name)
    print(json.dumps({
        "result": "VSIX_BUILT",
        "file": str(out),
        "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
        "entries": len(zipfile.ZipFile(out).namelist()),
    }))

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python build_vsix.py <output.vsix>")
    main(Path(sys.argv[1]))
