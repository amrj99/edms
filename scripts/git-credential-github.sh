#!/bin/bash
# Git credential helper for GitHub.
# Called by git at push/pull time — never run directly.
# Reads the token from the environment variable; the token itself
# is stored in Replit secrets and never appears in commands or logs.
echo "username=x-token"
echo "password=${GITHUB_PERSONAL_ACCESS_TOKEN}"
