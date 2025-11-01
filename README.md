# Sommalier Gent - Wine Agent Website

A one-page website with an embedded Salesforce Agentforce agent, deployed on Heroku.

## Files

- `index.html` - Main HTML file with Agentforce agent embedded
- `styles.css` - Styling for the transparent modal and layout
- `winery-background.png` - Background image
- `Procfile` - Heroku process file
- `static.json` - Heroku static site buildpack configuration

## Deployment

This site is configured to deploy to Heroku using the static site buildpack.

### Initial Setup

1. Install Heroku CLI if not already installed
2. Login to Heroku: `heroku login`
3. Deploy: `git push heroku main`

## Configuration

Agentforce agent is configured with:
- Organization ID: 00DHu00000izUN6
- Channel ID: 0MjHu000000XjEAKA0
- Site URL: https://storm-11c5bf736713cf.my.site.com/
