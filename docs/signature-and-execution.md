Locket does not sign. It prepares the approved version for the signing service you already use, then keeps what comes back.

## Prepare the signature package

On the **Signature** tab of an approved agreement, choose the **Signing service** (DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, Documenso, DocuSeal, paper or another route) and list the **Recipients, in signing order**, each as **Signer** or **Receives a copy**. **Prepare signature package** produces:

- the signature-ready PDF: the approved PDF itself, or a text PDF for a template version (a DOCX version needs the PDF it will be signed as, attached and approved first);
- a routing manifest naming the version, the document's SHA-256, the approvals, the service and the recipients in order.

Send it through your signing service yourself, then record the **Envelope ID** and choose **Mark sent**.

## Record the signed agreement

When the envelope is complete, open **Execution** and fill in **Record the signed agreement**: the **Signed PDF**, the **Certificate of completion (as issued by the provider)**, the **Executed on** date and the signers. Confirm the document is the one you sent, then **Record execution**.

Locket checks the envelope ID against the handoff, the signers against the package and that a certificate is present. A clean match marks the agreement **Executed**. A mismatch stays unsigned until the owner or counsel accepts it with a reason. The same signed file or envelope cannot be recorded twice.

Signed files and certificates keep their exact bytes. Locket never re-signs a document or makes a certificate in a provider's name.
