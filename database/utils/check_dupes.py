import re

with open(r'database\005_import_real_data.sql', 'r', encoding='utf-8') as f:
    content = f.read()

# Check duplicates only in the FIRST column (the id) of each INSERT
tables = {
    'projects': [],
    'scholarship_holders': [],
    'scholarships': [],
    'funding_releases': [],
    'expenses': [],
    'dashboard_settings': [],
}

# Extract the first UUID from each VALUES row (the row's own ID)
uuid_pattern = r"'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'"

current_table = None
for line in content.split('\n'):
    if 'INSERT INTO public.' in line:
        for t in tables:
            if t in line:
                current_table = t
                break
    elif current_table and line.strip().startswith("('"):
        # First UUID in the line is the row ID
        match = re.search(uuid_pattern, line)
        if match:
            tables[current_table].append(match.group(1))
    elif line.strip() == '' or line.startswith('--'):
        current_table = None

total_dupes = 0
for table, ids in tables.items():
    seen = set()
    dupes = []
    for uid in ids:
        if uid in seen:
            dupes.append(uid)
        seen.add(uid)
    if dupes:
        print(f'DUPLICATAS em {table}: {len(dupes)}')
        for d in dupes:
            print(f'  {d}')
        total_dupes += len(dupes)
    else:
        print(f'OK {table}: {len(ids)} IDs unicos')

if total_dupes == 0:
    print(f'\nTODO OK - Nenhuma duplicata de ID encontrada!')
else:
    print(f'\nERRO - {total_dupes} duplicatas encontradas!')
