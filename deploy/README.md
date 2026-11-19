# Deploying

The simulator runs on an Ubuntu VM that can host several projects. One
shared Caddy proxy owns ports 80/443 and gets HTTPS certificates
automatically; each project runs as its own Docker Compose stack on a
shared Docker network called `web`.

```
~/proxy/                 shared Caddy
    compose.yaml
    Caddyfile            imports sites/*.caddy
    sites/boating.caddy  one file per project
~/apps/boating/          this repo
~/apps/<project>/        other projects
```

## First deploy (and updates)

On the VM:

```bash
curl -fsSLO https://raw.githubusercontent.com/code-Harsh247/Multi-threaded-Programming/master/deploy/setup.sh
bash setup.sh boats.<ip-with-dashes>.sslip.io
```

To update the simulator later, run `bash ~/apps/boating/deploy/setup.sh <same address>` again.

[sslip.io](https://sslip.io) turns a name like `boats.129-146-10-20.sslip.io`
into the IP `129.146.10.20`, so every project can have its own HTTPS
address without buying a domain.

On Oracle Cloud, also allow TCP 80 and 443 from `0.0.0.0/0` in the
subnet's security list. `setup.sh` opens them in the VM's own firewall.

## Adding another project

1. Put it in `~/apps/<project>` with a `compose.yaml` that has its own
   `name:` and whose web service joins the `web` network under a unique
   alias, publishing no ports:

   ```yaml
   name: myproject
   services:
     app:
       build: .
       restart: unless-stopped
       networks:
         web:
           aliases: [myproject]
   networks:
     web:
       external: true
   ```

2. Start it: `cd ~/apps/<project> && sudo docker compose up -d --build`.
3. Add `~/proxy/sites/<project>.caddy`:

   ```
   myproject.<ip-with-dashes>.sslip.io {
   	reverse_proxy myproject:8080
   }
   ```

4. Reload the proxy:
   `sudo docker compose -f ~/proxy/compose.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile`

Only 80/443 should be open to the internet; keep databases and other
services on the internal `web` network (or a project-private one).
