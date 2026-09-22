# -*- coding: none -*-
"""Probe: what CLI args does the demo script actually receive on Windows?"""
import subprocess, sys, os
# Simulate `npm run demo` argv handling which runs through bash -c on Windows
os.chdir(r"C:/Users/Phoenix/Hermes-Workspace/agentic-software-team")
out = subprocess.run(
    ["npx", "tsx", "src/cli/create-project.ts", "--idea", "Build a web application that tracks personal software projects", "--name", "demo-probe", "--noop"],
    capture_output=True, text=True, timeout=30,
)
print("STDOUT head:", (out.stdout or "")[:400])
print("STDERR head:", (out.stderr or "")[:400])
