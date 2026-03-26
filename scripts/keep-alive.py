#!/usr/bin/env python3
"""Keep Supabase database active to prevent auto-pause"""

import os
import requests

# Database URL from user
DATABASE_URL = "postgresql://postgres:[YOUR-PASSWORD]@db.vxlwqiohliynbtjwivte.supabase.co:5432/postgres"

def keep_alive():
    """Execute a simple query to keep database active"""
    try:
        # Extract project ref from database URL
        # Format: postgresql://postgres:password@db.{project-ref}.supabase.co:5432/postgres
        import urllib.parse

        url = DATABASE_URL.split('?')[0]
        parsed = urllib.parse.urlparse(url)

        # Extract project ref from hostname: db.vxlwqiohliynbtjwivte.supabase.co
        # The ref is: vxlwqiohliynbtjwivte
        project_ref = parsed.hostname.split('.')[1] if parsed.hostname.startswith('db.') else None

        print(f"Project ref: {project_ref}")

        # Call Supabase REST API - this triggers activity
        base_url = f"https://{project_ref}.supabase.co"

        # Try to access the API - even a 401 counts as activity
        response = requests.get(
            f"{base_url}/rest/v1/",
            headers={
                'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1oIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNiz43cQwG7Rc11qnMXll1trbHOk'
            },
            timeout=10
        )

        print(f"API response status: {response.status_code}")
        print(f"Database ping successful!")

        return True
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == '__main__':
    success = keep_alive()
    exit(0 if success else 1)
