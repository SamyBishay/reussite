from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
d='/usr/share/fonts/liberation-sans-fonts/LiberationSans-'
for n,f in [('R','Regular'),('B','Bold'),('I','Italic'),('BI','BoldItalic')]:
    pdfmetrics.registerFont(TTFont('L'+n,d+f+'.ttf'))
pdfmetrics.registerFontFamily('L',normal='LR',bold='LB',italic='LI',boldItalic='LBI')
ink=HexColor('#222'); acc=HexColor('#3b4a7a')
B=ParagraphStyle('b',fontName='LR',fontSize=10.5,leading=15,textColor=ink,spaceAfter=6)
H1=ParagraphStyle('h1',parent=B,fontName='LB',fontSize=22,leading=27,textColor=acc,spaceAfter=10)
H2=ParagraphStyle('h2',parent=B,fontName='LB',fontSize=15,leading=19,textColor=acc,spaceBefore=14,spaceAfter=6)
H3=ParagraphStyle('h3',parent=B,fontName='LB',fontSize=11.5,spaceBefore=8,spaceAfter=3)
LI=ParagraphStyle('li',parent=B,leftIndent=16,bulletIndent=2,spaceAfter=3)
Q=ParagraphStyle('q',parent=B,fontName='LI',leftIndent=14,rightIndent=8,backColor=HexColor('#eef0f6'),borderPadding=6,spaceBefore=4,spaceAfter=10)
N=ParagraphStyle('n',parent=B,fontSize=9.5,textColor=HexColor('#555'))
s=[]
def p(t,st=B): s.append(Paragraph(t,st))
def ol(items):
    for i,t in enumerate(items,1): s.append(Paragraph(t,LI,bulletText=f'{i}.'))
def ul(items):
    for t in items: s.append(Paragraph(t,LI,bulletText='•'))
URL='https://reussite.rudolphem.workers.dev'
p('Réussite: set-up guide',H1)
p('Réussite is a planning app built on a CBT method for adult ADHD. It is a web app: nothing to download from a store, and your list lives on your own device. This guide covers four things: installing it on your phone, installing it on your laptop, connecting it to your Claude account, and the “stream of consciousness” way of using it.')
p(f'The app is at <b>{URL}</b>',B)

p('1. On your phone',H2)
p('Open the app’s address in your phone’s browser, then add it to the home screen. It then opens like any other app and works offline.')
p('iPhone or iPad',H3)
ol(['Open the address in <b>Safari</b> (not another browser).','Tap <b>Share</b>, then <b>Add to Home Screen</b>.','Open Réussite from the new home-screen icon, not from Safari.'])
p('Notifications only work when the app is opened from the Home Screen.',N)
p('Android',H3)
ol(['Open the address in <b>Chrome</b>.','Tap the three-dot menu, then <b>Install app</b> (or <i>Add to Home screen</i>).','Open Réussite from the new icon.'])
p('The first time you open it',H3)
p('Réussite asks a few questions, one per screen: language, where you spend your time (add at least one place, such as Home or Work), the four kinds of cards, light or dark, and a few optional ones (addresses and people, an AI, sync, reminders). Every screen has Back and Next, and <b>Skip, use defaults</b> skips the rest. Everything can be changed later in Settings.')
p('If you already use Réussite on another device, choose <b>I already use Réussite on another device</b> on the first screen and enter your recovery key.')

p('2. On your laptop',H2)
ol(['Open the address in <b>Chrome, Edge or Firefox</b>.','In Chrome or Edge, click the <b>install icon</b> at the right end of the address bar. Réussite then opens in its own window, like an app.','In Firefox there is no install icon: just keep it as a pinned tab or a bookmark. It works the same.'])
p('Using it on both phone and laptop',H3)
p('Each device keeps its own copy of your list. To have the same list on both, switch on sync: <b>Settings → Sync &amp; devices</b>. Your list is scrambled (encrypted) on your device before it is sent. Réussite gives you a <b>recovery key</b>: save it somewhere safe (a password manager is ideal). Without it, a lost device cannot be recovered. On the second device, choose <i>I already use Réussite on another device</i> and enter the key.')

p('3. Adding the connector to your Claude account',H2)
p('The connector lets Claude read and edit your list while you chat with it. <b>It needs sync switched on first</b> (section 2).')
p('Please read this before you switch it on',H3)
p('While the connector is on, whoever runs the sync relay can read your whole list. With it off, they see only scrambled data. Notes in Memory that you mark <b>Private</b> are never readable by Claude or any AI. Switching the connector off signs every AI app out at once.')
ol(['In Réussite, open <b>Settings → Connector</b> and tap <b>Switch on</b>. Read what it says. The app shows you an <b>address</b> (a URL).',
 'In Claude (claude.ai or the Claude app), open <b>Settings → Connectors → Add custom connector</b>. Give it a name such as “Réussite”, paste the address, and sign in.',
 'Réussite shows a <b>pairing code</b>. Type it where Claude asks. It works once and lasts ten minutes; if it expires, switch the connector off and on for a new one.',
 'Check it worked: start a new chat in Claude and ask “What’s on my list today?”. Claude should answer from your steps.'])
p('How Claude edits your list',H3)
ul(['<b>One small change</b> that you asked for (add a step, tick one done, move a date) goes in at once. Claude tells you, and you get an undo.',
 '<b>Anything else</b> (dropping steps, several changes, decisions) comes back as a list of changes and waits for your yes in the chat.',
 '<b>Anything touching your Memory notes</b> always waits for your yes.',
 'Every change can be undone, from the app’s History or by asking Claude.'])

p('4. The stream-of-consciousness workflow',H2)
p('The idea: you do not organise anything yourself. You talk, in whatever order it comes, and Claude sorts it into your list. This suits ADHD well: the hard part is starting, and “write it down in the right place, with a date and a size” is a lot of small decisions that stop you before you begin.')
p('Step by step',H3)
ol(['<b>Open a Claude chat</b> (phone or laptop) with the Réussite connector on. Voice dictation works well here.',
 '<b>Say everything that is on your mind</b>, unsorted: things to do, worries, dates, people, half-ideas.',
 '<b>Claude files it.</b> It reads your current list first (so it doesn’t duplicate), then turns the ramble into steps with a concrete first action, a project, a due date where you gave one, and an estimate. Small adds go straight in; bigger sets come back as a list for your yes.',
 '<b>Answer its questions, one at a time.</b> It asks only when it can’t tell what you mean (which step? what date?). Say “skip” for anything you don’t want to deal with now.',
 '<b>Say yes to what looks right</b>, change what doesn’t, and say no to the rest. Nothing big is written without your yes.',
 '<b>End with one thing to start.</b> Ask “what’s my first step?”. Claude gives you a single small starter, such as “Open Mail and ask the agency for the date”. Then stop talking and do it.'])
p('Example',H3)
p('“Ok so I need to call the bank, tomorrow ideally, and the photos for the visa are due Friday, I keep forgetting, and I should probably think about whether to move flats but I can’t face it, oh and choir is Wednesday 19:30.”',Q)
p('Claude adds “Call the bank” (tomorrow) and “Photos for the visa” (Friday), puts choir in on Wednesday at 19:30, and offers to turn “move flats” into a decision to work through later rather than a task. You confirm, and ask for your first step.')
p('Good habits',H3)
ul(['Do it at the same moments each day: before you start, and when you notice you are stuck.',
 'Say new facts about people or places out loud (“Ibrahim starts his job in March”). Claude can offer to save them as a Memory note, always with your yes.',
 'Ask Claude to “follow the method” when planning your day: it can fetch Réussite’s method and use it.',
 'No need to tidy your wording. A short line with no verb just goes to your Inbox, and you can sort it in the weekly review.',
 'Made a mistake? Say “undo that”.'])
p('Without the connector',H3)
p('You can do the same without a connection. On Home, type or dictate a line in the one box at the bottom (“call the bank tomorrow”, “dentist Friday 14h”). Or use <b>Ask any AI</b> to copy your list into any chatbot, and <b>Paste the reply</b> to bring the changes back. You see every change before it is written.')

p('Where to look next',H2)
ul([f'The manual: {URL}/manual/ (also in the app under Settings → About; French at /manual/fr/).','Help for a lost device: the manual page “Sync and recovering a lost device”.'])
def foot(c,doc):
    c.saveState(); c.setFont('LR',8.5); c.setFillColor(HexColor('#777')); c.drawString(54,30,'Réussite: set-up guide'); c.drawRightString(A4[0]-54,30,str(doc.page)); c.restoreState()
SimpleDocTemplate('docs/setup-guide.en.pdf',pagesize=A4,leftMargin=54,rightMargin=54,topMargin=54,bottomMargin=54,title='Réussite: set-up guide',author='').build(s,onFirstPage=foot,onLaterPages=foot)
