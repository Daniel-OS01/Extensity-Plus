import re

files = ['index.html', 'profiles.html']

for file in files:
    with open(file, 'rb') as f:
        content = f.read().decode('utf-8')

    new_content = ""
    # Process the file keeping newlines

    lines = content.splitlines(True)
    for line in lines:
        if '<button' in line and '<i class="fa' in line:
            # We are replacing `title="X"` with `title="X" aria-label="X"`
            title_m = re.search(r'title="([^"]+)"', line)
            if title_m and 'aria-label' not in line:
                line = line.replace(f'title="{title_m.group(1)}"', f'title="{title_m.group(1)}" aria-label="{title_m.group(1)}"')

            # Add aria-hidden="true" to the i tag if it's missing
            if 'aria-hidden' not in line:
                # Find the i tag and add aria-hidden
                line = re.sub(r'(<i class="fa[^>]*)(?<!aria-hidden="true")>', r'\1 aria-hidden="true">', line)

        new_content += line

    with open(file, 'wb') as f:
        f.write(new_content.encode('utf-8'))
