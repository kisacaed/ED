import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('google-cloud.sh').resolve()

class GoogleCloudSetupTests(unittest.TestCase):
    def run_case(self, case):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / 'calls.jsonl'
            stub = root / 'gcloud'
            stub.write_text('''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['GCLOUD_TEST_LOG'],'a') as log: log.write(json.dumps(args)+'\\n')
cmd=[a for a in args if not a.startswith('--')]
case=os.environ['GCLOUD_TEST_CASE']
if cmd[:2]==['auth','list']: print('authorized@example.test')
elif cmd[:2]==['services','enable']:
 if case=='api_denied': print('API permission denied',file=sys.stderr);sys.exit(1)
elif cmd[:3]==['compute','instances','list']:
 if case=='list_denied': print('Compute access denied',file=sys.stderr);sys.exit(1)
 if case=='exists': print('ed-kocluk')
elif cmd[:3]==['compute','addresses','describe']: print('203.0.113.10')
elif cmd[:2]==['compute','ssh']: sys.stdin.read()
''')
            stub.chmod(0o755)
            env = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'], 'GCLOUD_TEST_LOG': str(log), 'GCLOUD_TEST_CASE': case}
            result = subprocess.run(['bash',str(SCRIPT),'sinavmatikkocgpt'],env=env,capture_output=True,text=True,timeout=30)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            return result,calls

    def test_api_denial_is_visible_and_stops_before_compute(self):
        result,calls=self.run_case('api_denied')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('API permission denied',result.stderr)
        self.assertFalse(any('compute' in c for c in calls))

    def test_compute_denial_does_not_create_resources(self):
        result,calls=self.run_case('list_denied')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Compute access denied',result.stderr)
        self.assertFalse(any('create' in c for c in calls))
        enable=next(i for i,c in enumerate(calls) if 'enable' in c)
        first_compute=next(i for i,c in enumerate(calls) if 'compute' in c)
        self.assertLess(enable,first_compute)

    def test_existing_instance_and_data_are_preserved(self):
        result,calls=self.run_case('exists')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('already exists',result.stdout)
        self.assertFalse(any('create' in c or 'scp' in c or 'ssh' in c for c in calls))

    def test_successful_flow_has_progress_and_noninteractive_compute(self):
        result,calls=self.run_case('success')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('[7/7]',result.stdout)
        self.assertTrue(any('scp' in c for c in calls))
        self.assertTrue(any('ssh' in c for c in calls))
        self.assertTrue(all('--quiet' in c for c in calls if 'compute' in c))
        self.assertFalse(any('instances' in c and 'describe' in c for c in calls))

if __name__=='__main__':
    unittest.main()
