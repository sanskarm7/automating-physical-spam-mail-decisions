
# MailWolf

i get a lot of spam mail from not only people that used to live at my house, but from marketers that 
have gotten my address overtime.

this project is an effort to scan my email for USPS inbound spam utilizing "USPS Informed Delivery".

there is no customer facing API so i'm forced to take the unconventional approach of scraping my email for 
notifications.

after this, images will be scanned using OCR and the sender's details will be recorded.

then i will reference the sender's "opt-out" form / customer solutions email saved in my MySQL db.

using an LLM, the form will be filled and/or an email will be sent.

in the end all you have to do is mark the physical mail as "return to sender" and the idea is that
the company is aware that you want them to stop.
