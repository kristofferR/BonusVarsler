<img src="icon.png" alt="BonusVarsler" width="64" align="left" style="margin-right: 16px;">

# BonusVarsler

**Trumf | SAS EuroBonus | re:member | DNB | OBOS | NAF | LOfavør**

<p align="center">

![Versjon](https://img.shields.io/badge/Versjon-8.0-blue)
![Lisens](https://img.shields.io/badge/Lisens-GPL--3.0-green)
![Støttet i](https://img.shields.io/badge/Støttet_i-Chrome%20|%20Firefox%20|%20Edge%20|%20Safari-yellow)

</p>

---

**Glem aldri cashback-bonus igjen!** En lett og stilren nettleserutvidelse som varsler deg når du besøker en nettbutikk som gir bonus.

> 🛒 Dette er et uavhengig hobbyprosjekt og har ingen tilknytning til Trumf, SAS EuroBonus, re:member, DNB, OBOS, LO eller andre bonusprogrammer.

- Lynrask og ressursvennlig — du merker ikke at den kjører
- Stilrent design med lys/mørk modus
- Respekterer personvernet ditt — ingen sporing

---
<p align="center">
  <a href="https://chromewebstore.google.com/detail/bonusvarsler-lite-for-tru/ldnjfkeilnhpghjcogjchdchhfplcdmp"><img src="https://raw.githubusercontent.com/kazcfz/Browser-Promotional-Badges/refs/heads/main/Google/Chrome%20Web%20Store/SVG%20(with%20border).svg" alt="Chrome Web Store" width="230" height="60"></a>
  <a href="https://addons.mozilla.org/firefox/addon/bonusvarsler/"><img src="https://raw.githubusercontent.com/kazcfz/Browser-Promotional-Badges/refs/heads/main/Mozilla/Firefox/Get%20The%20Add-On.svg" alt="Firefox Add-on" width="172" height="60"></a>
</p>

---

<p align="center">
  <img src="https://github.com/kristofferR/BonusVarsler/raw/main/video.gif" width="50%">
</p>

## Hvorfor bruke dette?

Bonusprogrammer som Trumf, SAS EuroBonus, re:member, OBOS, NAF og LOfavør gir deg cashback eller poeng hos hundrevis av nettbutikker, men du må huske å gå via deres portal for at bonusen skal registreres. Det er lett å glemme.

Denne utvidelsen løser problemet: Du handler som vanlig, og får et varsel når butikken gir bonus. Ett klikk, så er du i gang.

---

## Funksjoner

- **Fungerer i alle nettlesere** — Chrome, Firefox, Edge, Brave, Opera, Safari
- **Drabar notifikasjon** — Dra varselet til hvilken som helst hjørne, så husker den posisjonen
- **Minimerbar** — Klikk på headeren for å minimere, klikk igjen for å utvide
- **Lys/mørk modus** — Følger systemet ditt, eller velg manuelt
- **Skjul per nettsted** — Får du ikke bonus hos favorittbutikken? Skjul varselet der permanent
- **Adblocker-advarsel** — Bonus-tracking fungerer ikke med adblocker, så du får beskjed
- **Påminnelse på bonusportalen** — Ekstra varsel på bonusportalen så du ikke glemmer å klikke riktig

---

## Installering

### Nettleserutvidelse (anbefalt)

<p align="center">
  <a href="https://chromewebstore.google.com/detail/bonusvarsler-lite-for-tru/ldnjfkeilnhpghjcogjchdchhfplcdmp"><img src="https://raw.githubusercontent.com/kazcfz/Browser-Promotional-Badges/refs/heads/main/Google/Chrome%20Web%20Store/SVG%20(with%20border).svg" alt="Chrome Web Store" width="230" height="60"></a>
  <a href="https://addons.mozilla.org/firefox/addon/bonusvarsler/"><img src="https://raw.githubusercontent.com/kazcfz/Browser-Promotional-Badges/refs/heads/main/Mozilla/Firefox/Get%20The%20Add-On.svg" alt="Firefox Add-on" width="172" height="60"></a>
</p>

<details>
<summary>Manuell installering (for utviklere)</summary>

#### Chrome / Edge / Brave / Opera

1. Last ned eller klon dette repositoriet
2. Gå til `chrome://extensions/` (eller tilsvarende for din nettleser)
3. Aktiver "Utviklermodus" øverst til høyre
4. Klikk "Last inn upakket" og velg mappen med utvidelsen

#### Firefox

1. Last ned eller klon dette repositoriet
2. Gå til `about:debugging#/runtime/this-firefox`
3. Klikk "Last midlertidig tillegg..."
4. Velg `manifest.json` i mappen med utvidelsen

> **Merk:** Midlertidige tillegg i Firefox fjernes når nettleseren lukkes.

</details>

### Userscript (alternativ)

Foretrekker du en userscript-manager eller bruker iOS? BonusVarsler er også tilgjengelig som userscript.

**1. Installer en userscript-manager:**
- Desktop: [Violentmonkey](https://violentmonkey.github.io/) (anbefalt)
- iOS: [Userscripts](https://apps.apple.com/no/app/userscripts/id1463298887) (gratis)

**2. Installer scriptet:**

**[Klikk her for å installere BonusVarsler (Userscript)](https://github.com/kristofferR/BonusVarsler/raw/main/BonusVarsler.user.js)**

---

## Bruk

Bare surf som vanlig. Når du besøker en nettbutikk som gir bonus, dukker varselet opp.

**Tips:**
- **Dra varselet** til hjørnet du foretrekker — den husker posisjonen
- **Klikk headeren** for å minimere/utvide
- **Tannhjulet** åpner innstillinger (tema, start minimert, skjulte sider)
- **"Ikke vis på denne siden"** skjuler varselet permanent for det nettstedet

### Innstillinger

**Utvidelse:** Høyreklikk på utvidelsesikonet og velg "Alternativer" for å åpne innstillingssiden.

**Userscript:** Høyreklikk på userscript-ikonet for menyvalg.

---

## Personvern

Utvidelsen henter kun offisielle butikklister fra bonusprogrammene. Ingen data om deg eller din surfing sendes noe sted.

---

## Utvikling

### LogBuy scraper credentials

LogBuy-scraperen i `scripts/scrape-feeds.ts` bruker Visma LogBuy API-et og krever tre miljøvariabler når du kjører `bun scripts/scrape-feeds.ts` eller `bun run build`:

- `LOGBUY_USERNAME` - brukernavn for LogBuy API-/extension-kontoen
- `LOGBUY_PASSWORD` - passord for samme konto
- `LOGBUY_ACCESSKEY` - access key fra LogBuy-konfigurasjonen

Verdiene må hentes fra en LogBuy-konto/API-konfigurasjon du har tilgang til. Ikke commit dem i repoet. I GitHub Actions skal de legges inn som repository secrets med samme navn; `.github/workflows/update-feed.yml` validerer at de finnes og sender dem videre til scraper-steget.

---

## Lisens

[GPL-3.0](LICENSE) — fri programvare under GPL v3

---

## Problemer eller forslag?

[Opprett en issue på GitHub](https://github.com/kristofferR/BonusVarsler/issues)
